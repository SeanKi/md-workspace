// 다른 도구가 만든 마크다운을 MDXEditor 가 읽을 수 있게 다듬는다.
//
// MDXEditor 는 마크다운을 **MDX 로** 읽는다. MDX 에서 `<` 는 JSX 의 시작이라
// 태그가 아닌 `<` 를 만나면 파싱이 통째로 실패한다. GitHub·VS Code·Obsidian 은
// 같은 파일을 문제없이 읽으므로, **파일이 잘못된 게 아니라 이 에디터만 못 읽는다.**
//
//   Error parsing markdown: Expected a closing tag for `<br>`
//   Error parsing markdown: Unexpected character `-` (U+002D) before name
//
// 파서 설정으로 끌 수는 없다 — mdx-jsx 확장이 MDXEditor 코어에 박혀 있다.
// 그래서 파일을 열 때 세 가지를 손본다.
//
//   1. `<br>` `<hr>`        → `<br />` `<hr />`   (닫는 태그를 기다리다 실패)
//   2. `<https://x>` `<a@b>` → `[x](x)`            (자동링크는 MDX 가 못 읽는다)
//   3. 태그가 아닌 `<`        → `&lt;`              (`<- 1`, `<3`, `a<b` …)
//
// 세 가지 모두 **다른 도구에서 보이는 모습이 같다.** 그리고 코드블록과 인라인
// 코드 안은 건드리지 않는다 — 예제 코드를 고쳐 버리면 안 된다.
//
// 열었다고 파일이 바뀌지는 않는다. 디스크에 반영되는 시점은 사용자가 저장할 때다.

const VOID_RE = /<(br|hr)\s*>/gi

// MDX 가 알아보는 형태: 여는 태그 · 닫는 태그 · 주석
const TAG_RE = /^<\/?[A-Za-z][A-Za-z0-9.:_-]*(\s[^<>]*?)?\s*\/?>|^<!--[\s\S]*?-->/

// `<https://…>` `<mailto:…>` `<user@host>` — MDX 는 자동링크를 모른다
const AUTOLINK_RE = /<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+)>|<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/g

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const INLINE_CODE_RE = /(`+[^`]*`+)/

/** 자동링크를 평범한 마크다운 링크로. 보이는 모습과 누르는 동작이 같다. */
function fixAutolinks(text, stat) {
  return text.replace(AUTOLINK_RE, (whole, uri, mail) => {
    stat.autolinks += 1
    return uri ? `[${uri}](${uri})` : `[${mail}](mailto:${mail})`
  })
}

/** 태그로 읽힐 수 없는 `<` 만 `&lt;` 로. 멀쩡한 태그는 그대로 둔다. */
function fixAngles(text, stat) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '<') { out += text[i]; i += 1; continue }
    const m = TAG_RE.exec(text.slice(i))
    if (m) { out += m[0]; i += m[0].length; continue }
    out += '&lt;'
    stat.angles += 1
    i += 1
  }
  return out
}

/**
 * @param {string} markdown
 * @returns {{ text: string, count: number, stat: object }}
 *          count 가 0 이면 원본 그대로다.
 */
export function normalizeForEditor(markdown) {
  if (!markdown || !markdown.includes('<')) {
    return { text: markdown, count: 0, stat: { voidTags: 0, autolinks: 0, angles: 0 } }
  }

  const stat = { voidTags: 0, autolinks: 0, angles: 0 }
  let fence = null   // 열려 있는 코드펜스의 문자 (` 또는 ~)

  const text = markdown.split('\n').map((line) => {
    const f = FENCE_RE.exec(line)
    if (f) {
      const marker = f[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      return line
    }
    if (fence !== null) return line

    // 홀수 칸이 인라인 코드다 (split 의 캡처 그룹)
    return line.split(INLINE_CODE_RE).map((part, i) => {
      if (i % 2 === 1) return part
      let s = part.replace(VOID_RE, (_, tag) => {
        stat.voidTags += 1
        return `<${tag.toLowerCase()} />`
      })
      s = fixAutolinks(s, stat)
      return fixAngles(s, stat)
    }).join('')
  }).join('\n')

  return { text, count: stat.voidTags + stat.autolinks + stat.angles, stat }
}

/** 화면에 보여줄 한 줄 요약. 고친 게 없으면 빈 문자열. */
export function describeFixes(stat) {
  if (!stat) return ''
  const parts = []
  if (stat.voidTags) parts.push(`<br> ${stat.voidTags}개`)
  if (stat.angles) parts.push(`태그가 아닌 < ${stat.angles}개`)
  if (stat.autolinks) parts.push(`자동링크 ${stat.autolinks}개`)
  return parts.join(' · ')
}
