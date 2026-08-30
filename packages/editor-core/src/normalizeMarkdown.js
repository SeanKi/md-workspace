// 다른 도구가 만든 마크다운을 MDXEditor 가 읽을 수 있게 다듬는다.
//
// MDXEditor 는 마크다운을 **MDX 로** 읽는다. MDX 에서 `<` 는 JSX 의 시작이라,
// 태그로 이어지지 않으면 파싱이 통째로 실패한다. GitHub·VS Code·Obsidian 은 같은
// 파일을 문제없이 읽으므로 **파일이 잘못된 게 아니라 이 에디터만 못 읽는다.**
//
//   Error parsing markdown: Expected a closing tag for `<br>`
//   Error parsing markdown: Unexpected character `-` (U+002D) before name
//   Error parsing markdown: Unexpected character `2` (U+0032) before member name
//
// 파서 설정으로는 끌 수 없다 — mdx-jsx 확장이 MDXEditor 코어에 박혀 있다.
// 그래서 파일을 열 때 네 가지를 손본다.
//
//   1. void 태그        `<br>` `<img src=x>`  → `<br />` `<img src=x />`
//   2. 자동링크          `<https://x>`         → `[x](x)`
//   3. 태그가 아닌 `<`   `A <- B` `p<0.05`     → `&lt;`
//   4. 짝이 안 맞는 태그 `<div>` 만 있는 경우   → `&lt;div>`
//
// 3번의 판정이 이 파일의 핵심이다. **"태그처럼 생겼으면 통과" 로 하면 안 된다.**
// 문서에 XML 로그를 붙여 넣는 경우가 흔한데(`<root>`, `<GROUP NAME="0">`,
// `<P_20260525161121.222>`), 그건 마크업이 아니라 **보여 줄 텍스트**다.
// 그래서 실제 HTML 태그 목록에 있는 이름만 태그로 인정한다.
//
// 코드블록과 인라인 코드 안은 건드리지 않는다 — 예제 코드를 고쳐 버리면 안 된다.
// 열었다고 파일이 바뀌지는 않는다. 디스크에 반영되는 시점은 사용자가 저장할 때다.

// 마크다운 문서에 실제로 쓰이는 HTML 태그
const HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'i', 'iframe', 'img', 'input', 'ins', 'kbd',
  'li', 'main', 'mark', 'nav', 'ol', 'p', 'picture', 'pre', 'q', 's', 'samp',
  'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
  'var', 'video', 'wbr',
])

// 닫는 태그가 없는 태그들. MDX 는 이들도 자가닫힘이어야 받아들인다
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'col', 'source', 'wbr'])

// 이름 뒤에는 공백 · `/` · `>` 만 올 수 있다.
// (`<P_2026...>` 처럼 이름에 `_` 나 `.` 가 이어지면 태그가 아니다)
const TAG_RE = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(\s[^<>]*?)?\s*(\/?)>/
const COMMENT_RE = /^<!--[\s\S]*?-->/
const AUTOLINK_RE = /<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+)>|<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/g
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const INLINE_CODE_RE = /(`+[^`]*`+)/

/** 한 줄을 코드/비코드 조각으로 나눈다. 코드 조각은 끝까지 그대로 간다. */
function splitLines(markdown) {
  let fence = null
  return markdown.split('\n').map((line) => {
    const f = FENCE_RE.exec(line)
    if (f) {
      const marker = f[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      return [{ code: true, text: line }]
    }
    if (fence !== null) return [{ code: true, text: line }]
    return line.split(INLINE_CODE_RE).map((text, i) => ({ code: i % 2 === 1, text }))
  })
}

/** 왼쪽부터 훑으며 주석 · HTML 태그 · 그 외 `<` 를 구분한다. */
function* scan(text) {
  let i = 0
  let plain = ''
  const flush = function* () { if (plain) { yield { t: 'text', v: plain }; plain = '' } }

  while (i < text.length) {
    if (text[i] !== '<') { plain += text[i]; i += 1; continue }
    const rest = text.slice(i)

    const c = COMMENT_RE.exec(rest)
    if (c) { yield* flush(); yield { t: 'comment', v: c[0] }; i += c[0].length; continue }

    const m = TAG_RE.exec(rest)
    if (m && HTML_TAGS.has(m[2].toLowerCase())) {
      yield* flush()
      yield {
        t: 'tag', v: m[0], name: m[2].toLowerCase(),
        closing: m[1] === '/', selfClosing: m[4] === '/',
      }
      i += m[0].length
      continue
    }

    yield* flush()
    yield { t: 'angle', v: '<' }
    i += 1
  }
  yield* flush()
}

/**
 * 짝이 맞지 않는 태그 이름을 찾는다.
 * `<div>` 만 있고 `</div>` 가 없으면 MDX 는 끝까지 닫는 태그를 찾다 실패한다.
 * 그런 이름은 태그가 아니라 텍스트로 본다.
 */
function unbalancedTags(lines) {
  const depth = new Map()
  const bad = new Set()
  for (const parts of lines) {
    for (const part of parts) {
      if (part.code) continue
      for (const tok of scan(part.text)) {
        if (tok.t !== 'tag' || tok.selfClosing || VOID_TAGS.has(tok.name)) continue
        const d = (depth.get(tok.name) ?? 0) + (tok.closing ? -1 : 1)
        depth.set(tok.name, d)
        if (d < 0) bad.add(tok.name)   // 여는 태그보다 닫는 태그가 먼저 나왔다
      }
    }
  }
  for (const [name, d] of depth) if (d !== 0) bad.add(name)
  return bad
}

/** 자동링크를 평범한 마크다운 링크로. 보이는 모습과 누르는 동작이 같다. */
function fixAutolinks(text, stat) {
  return text.replace(AUTOLINK_RE, (whole, uri, mail) => {
    stat.autolinks += 1
    return uri ? `[${uri}](${uri})` : `[${mail}](mailto:${mail})`
  })
}

function transform(text, banned, stat) {
  let out = ''
  for (const tok of scan(text)) {
    if (tok.t === 'text' || tok.t === 'comment') { out += tok.v; continue }
    if (tok.t === 'angle') { out += '&lt;'; stat.angles += 1; continue }

    if (banned.has(tok.name)) {
      out += '&lt;' + tok.v.slice(1)
      stat.angles += 1
    } else if (VOID_TAGS.has(tok.name) && !tok.selfClosing && !tok.closing) {
      out += tok.v.slice(0, -1).trimEnd() + ' />'
      stat.voidTags += 1
    } else {
      out += tok.v
    }
  }
  return out
}

/**
 * @param {string} markdown
 * @returns {{ text: string, count: number, stat: { voidTags: number, autolinks: number, angles: number } }}
 *          count 가 0 이면 원본 그대로다.
 */
export function normalizeForEditor(markdown) {
  const stat = { voidTags: 0, autolinks: 0, angles: 0 }
  if (!markdown || !markdown.includes('<')) return { text: markdown, count: 0, stat }

  const lines = splitLines(markdown)
  const banned = unbalancedTags(lines)

  const text = lines.map((parts) => parts.map((part) => (
    part.code ? part.text : transform(fixAutolinks(part.text, stat), banned, stat)
  )).join('')).join('\n')

  return { text, count: stat.voidTags + stat.autolinks + stat.angles, stat }
}

/** 화면에 보여줄 한 줄 요약. 고친 게 없으면 빈 문자열. */
export function describeFixes(stat) {
  if (!stat) return ''
  const parts = []
  if (stat.voidTags) parts.push(`<br> 같은 태그 ${stat.voidTags}개`)
  if (stat.angles) parts.push(`태그가 아닌 < ${stat.angles}개`)
  if (stat.autolinks) parts.push(`자동링크 ${stat.autolinks}개`)
  return parts.join(' · ')
}
