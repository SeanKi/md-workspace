/*
 * mdast 인라인 → ProseMirror 인라인(JSON).
 *
 * 마크다운에는 색이 없어서 우리는 `<span style="color:…">` 를 쓴다(MDXEditor 때와 같은
 * 모양 — `editor-core/colorTools.jsx`). mdast 는 이것을 **여는 태그 · 글자 · 닫는 태그**
 * 세 조각으로 준다. 같은 부모 안에서 짝을 찾아 하나의 표시(mark)로 묶는다.
 * 짝이 없거나 모르는 태그는 원문 조각(rawInline)으로 남긴다 — 저장할 때 그대로 나간다.
 */

/** 줄바꿈은 편집기 안에서는 `\n` 하나로 다룬다 (CRLF 파일은 저장할 때 되돌린다) */
export const nl = (s) => String(s ?? '').replace(/\r\n?/g, '\n')

const slice = (node, text) => text.slice(node.position.start.offset, node.position.end.offset)

const SIMPLE = {
  u: { type: 'underline' },
  b: { type: 'bold' }, strong: { type: 'bold' },
  i: { type: 'italic' }, em: { type: 'italic' },
  s: { type: 'strike' }, del: { type: 'strike' }, strike: { type: 'strike' },
}

const OPEN = /^<([a-zA-Z]+)(\s[^<>]*)?>$/
const BR = /^<br\s*\/?>$/i

/** `style="color:#e11d48;background-color:#fef08a"` 만 받는다. 그 밖의 속성이 있으면 남의 span 이다 */
function spanMark(attrs) {
  const m = /^\s*style\s*=\s*"([^"]*)"\s*$/i.exec(attrs ?? '')
  if (!m) return null
  const out = {}
  for (const part of m[1].split(';')) {
    const [k, ...v] = part.split(':')
    const key = (k ?? '').trim().toLowerCase()
    const val = v.join(':').trim()
    if (!key) continue
    if (key === 'color') out.color = val
    else if (key === 'background-color' || key === 'background') out.backgroundColor = val
    else return null
  }
  if (!out.color && !out.backgroundColor) return null
  return { type: 'textStyle', attrs: { color: out.color ?? null, backgroundColor: out.backgroundColor ?? null } }
}

function markForTag(tag, attrs) {
  const t = tag.toLowerCase()
  if (t === 'span') return spanMark(attrs)
  if (attrs && attrs.trim()) return null
  return SIMPLE[t] ?? null
}

/** 같은 종류의 표시는 하나만 — 안쪽 것이 이긴다 */
const withMark = (marks, mark) => [...marks.filter((m) => m.type !== mark.type), mark]

function findClose(children, from, tag) {
  const open = new RegExp(`^<${tag}(\\s[^<>]*)?>$`, 'i')
  const close = new RegExp(`^</${tag}\\s*>$`, 'i')
  let depth = 0
  for (let j = from; j < children.length; j++) {
    const c = children[j]
    if (c.type !== 'html') continue
    const v = c.value.trim()
    if (open.test(v)) depth++
    else if (close.test(v)) { if (depth === 0) return j; depth-- }
  }
  return -1
}

export function inlineToPm(children, text, marks = [], opts = {}) {
  const out = []
  // 줄바꿈에도 표시를 건다 — 안 걸면 `**여러 줄  ⏎ 굵게**` 가 줄마다 굵게를 닫았다 연다
  const push = (node) => { if (marks.length) node.marks = marks; out.push(node) }

  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    switch (c.type) {
      case 'text': {
        const v = nl(c.value)
        if (v) push({ type: 'text', text: v })
        break
      }
      case 'strong': out.push(...inlineToPm(c.children, text, withMark(marks, { type: 'bold' }), opts)); break
      case 'emphasis': out.push(...inlineToPm(c.children, text, withMark(marks, { type: 'italic' }), opts)); break
      case 'delete': out.push(...inlineToPm(c.children, text, withMark(marks, { type: 'strike' }), opts)); break
      case 'inlineCode':
        if (c.value) out.push({ type: 'text', text: nl(c.value), marks: withMark(marks, { type: 'code' }) })
        break
      case 'link': {
        const mark = { type: 'link', attrs: { href: c.url, title: c.title ?? null } }
        const inner = inlineToPm(c.children, text, withMark(marks, mark), opts)
        // 글자 없는 링크(`[](url)`)는 표시를 걸 글자가 없다 — 원문으로
        if (inner.length) out.push(...inner)
        else push({ type: 'rawInline', attrs: { text: slice(c, text) } })
        break
      }
      case 'image':
        push({ type: 'image', attrs: { src: c.url, alt: c.alt ?? null, title: c.title ?? null } })
        break
      case 'break': {
        const raw = slice(c, text)
        push({ type: 'hardBreak', attrs: { kind: raw.startsWith('\\') ? 'backslash' : 'spaces' } })
        break
      }
      case 'html': {
        const v = c.value.trim()
        if (BR.test(v)) { push({ type: 'hardBreak', attrs: { kind: 'html', raw: c.value } }); break }
        const m = OPEN.exec(v)
        const mark = m && markForTag(m[1], m[2])
        const j = mark ? findClose(children, i + 1, m[1]) : -1
        // 빈 짝(`<b></b>`)은 표시를 걸 글자가 없어 사라진다 — 원문으로 둔다
        if (mark && j > i + 1) {
          out.push(...inlineToPm(children.slice(i + 1, j), text, withMark(marks, mark), opts))
          i = j
        } else {
          push({ type: 'rawInline', attrs: { text: nl(c.value) } })
        }
        break
      }
      default:
        // linkReference · imageReference · footnoteReference ...
        push({ type: 'rawInline', attrs: { text: nl(slice(c, text)) } })
    }
  }
  return out
}
