/*
 * ProseMirror 노드 → mdast. **고친 블록만** 여기를 지난다 (serialize.js).
 */

/** 바깥에서 안쪽 순서. 링크가 가장 바깥, 코드가 가장 안쪽이다 */
const ORDER = ['link', 'textStyle', 'underline', 'bold', 'italic', 'strike']
const rank = (m) => ORDER.indexOf(m.type.name)

function spanStyle(attrs) {
  const parts = []
  if (attrs.color) parts.push(`color:${attrs.color}`)
  if (attrs.backgroundColor) parts.push(`background-color:${attrs.backgroundColor}`)
  return parts.join(';')
}

/** 표시 하나를 mdast 부모로. HTML 로만 쓸 수 있는 것은 감싸개(_wrap)로 두고 나중에 편다 */
function open(mark) {
  switch (mark.type.name) {
    case 'bold': return { type: 'strong', children: [] }
    case 'italic': return { type: 'emphasis', children: [] }
    case 'strike': return { type: 'delete', children: [] }
    case 'link': return { type: 'link', url: mark.attrs.href ?? '', title: mark.attrs.title || null, children: [] }
    case 'underline': return { type: '_wrap', open: '<u>', close: '</u>', children: [] }
    case 'textStyle': {
      const style = spanStyle(mark.attrs)
      return style
        ? { type: '_wrap', open: `<span style="${style}">`, close: '</span>', children: [] }
        : { type: '_wrap', open: '', close: '', children: [] }
    }
    default: return { type: '_wrap', open: '', close: '', children: [] }
  }
}

function unwrap(nodes) {
  const out = []
  for (const n of nodes) {
    if (n.children) n.children = unwrap(n.children)
    if (n.type !== '_wrap') { out.push(n); continue }
    if (n.open) out.push({ type: 'html', value: n.open })
    out.push(...n.children)
    if (n.close) out.push({ type: 'html', value: n.close })
  }
  return out
}

function leaf(node, inTable) {
  switch (node.type.name) {
    case 'text':
      return node.marks.some((m) => m.type.name === 'code')
        ? { type: 'inlineCode', value: node.text }
        : { type: 'text', value: node.text }
    case 'hardBreak':
      // 표 셀 안에서는 GFM 이 줄바꿈을 못 담는다 — `<br />` 로 (CLAUDE.md)
      if (inTable || node.attrs.kind === 'html') return { type: 'html', value: node.attrs.raw || '<br />' }
      return { type: 'break', data: { kind: node.attrs.kind } }
    case 'image':
      return { type: 'image', url: node.attrs.src ?? '', alt: node.attrs.alt ?? '', title: node.attrs.title || null }
    case 'rawInline':
      return { type: 'html', value: node.attrs.text ?? '' }
    default:
      return { type: 'text', value: node.textContent }
  }
}

/** 평평한 인라인 목록을 표시의 공통 접두로 묶어 트리로 만든다 (prosemirror-markdown 과 같은 방식) */
export function inlineToMdast(parent, inTable = false) {
  const root = []
  const stack = []   // { mark, children }
  const top = () => (stack.length ? stack[stack.length - 1].children : root)
  parent.forEach((child) => {
    const marks = child.marks.filter((m) => rank(m) >= 0)
    // 이미 열려 있는 표시는 계속 연다 — `*기울임 **굵게** 기울임*` 에서 굵게를 만났다고
    // 기울임을 닫았다 다시 열면 `*…*` `***…***` 로 쪼개진다. 새로 여는 것만 순서대로
    let k = 0
    while (k < stack.length && marks.some((m) => m.eq(stack[k].mark))) k++
    stack.length = k
    const fresh = marks.filter((m) => !stack.some((s) => s.mark.eq(m))).sort((a, b) => rank(a) - rank(b))
    for (const mark of fresh) {
      const node = open(mark)
      top().push(node)
      stack.push({ mark, children: node.children })
    }
    top().push(leaf(child, inTable))
  })
  return unwrap(root)
}

const blocks = (node) => {
  const out = []
  node.forEach((c) => out.push(blockToMdast(c)))
  return out
}

/**
 * Tiptap 의 목록 항목은 문단으로 시작해야 해서, `- 1. 하위` 처럼 목록으로 바로 시작하는
 * 항목에는 열 때 빈 문단을 끼워 넣었다 (toPm.js). 쓸 때 걷어낸다
 */
function itemBlocks(item) {
  const out = blocks(item)
  if (out.length > 1 && out[0].type === 'paragraph' && !out[0].children.length) out.shift()
  return out
}

function list(node, extra) {
  const spread = !!node.attrs.spread
  const children = []
  node.forEach((item) => children.push({
    type: 'listItem',
    spread,
    checked: item.type.name === 'taskItem' && item.attrs.checked != null ? !!item.attrs.checked : null,
    children: itemBlocks(item),
  }))
  return { type: 'list', spread, children, ...extra }
}

function table(node) {
  const rows = []
  node.forEach((row) => {
    const cells = []
    row.forEach((cell) => cells.push({
      type: 'tableCell',
      children: cell.firstChild ? inlineToMdast(cell.firstChild, true) : [],
    }))
    rows.push({ type: 'tableRow', children: cells })
  })
  return { type: 'table', align: node.attrs.align ?? [], children: rows }
}

export function blockToMdast(node) {
  switch (node.type.name) {
    case 'paragraph': return { type: 'paragraph', children: inlineToMdast(node) }
    case 'heading': return { type: 'heading', depth: node.attrs.level, children: inlineToMdast(node) }
    case 'blockquote': return { type: 'blockquote', children: blocks(node) }
    case 'bulletList': return list(node, { ordered: false })
    case 'taskList': return list(node, { ordered: false })
    case 'orderedList': return list(node, { ordered: true, start: node.attrs.start ?? 1 })
    case 'codeBlock': return { type: 'code', lang: node.attrs.language || null, value: node.textContent }
    case 'horizontalRule': return { type: 'thematicBreak' }
    case 'table': return table(node)
    case 'rawBlock': return { type: 'html', value: node.textContent }
    default: return { type: 'html', value: node.textContent }
  }
}
