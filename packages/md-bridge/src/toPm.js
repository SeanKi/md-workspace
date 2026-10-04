import { inlineToPm, nl } from './inlineToPm.js'
import { displayWidth } from './width.js'

/*
 * mdast 블록 → ProseMirror(JSON). 노드 이름은 Tiptap 스키마를 따른다
 * (`editor-tiptap/src/extensions.js`).
 *
 * 위지윅으로 그릴 수 없는 것(HTML 블록, 참조 링크 정의, 각주, 앞머리 YAML,
 * 정보 문자열이 붙은 코드블록)은 **원문 블록(rawBlock)** 으로 들고 다닌다.
 * 그 자리에서 글자로 고칠 수 있고, 저장할 때 그대로 나간다.
 */

const slice = (node, text) => text.slice(node.position.start.offset, node.position.end.offset)
const para = (content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const textNode = (value) => (value ? [{ type: 'text', text: value }] : [])

export function rawBlock(kind, value) {
  return { type: 'rawBlock', attrs: { kind }, content: textNode(nl(value)) }
}

export function blockToPm(node, text) {
  switch (node.type) {
    case 'paragraph':
      return para(inlineToPm(node.children, text))
    case 'heading':
      return { type: 'heading', attrs: { level: node.depth }, content: inlineToPm(node.children, text) }
    case 'thematicBreak':
      return { type: 'horizontalRule' }
    case 'blockquote':
      return { type: 'blockquote', content: blocksOrPara(node.children, text) }
    case 'list':
      return list(node, text)
    case 'code':
      // 정보 문자열 뒤의 meta(```js title="a"`)는 담을 칸이 없다 — 원문으로
      if (node.meta) return rawBlock('code', slice(node, text))
      return { type: 'codeBlock', attrs: { language: node.lang || null }, content: textNode(nl(node.value)) }
    case 'table':
      return table(node, text)
    case 'html':
      return rawBlock('html', slice(node, text))
    default:
      // definition · footnoteDefinition · yaml ...
      return rawBlock(node.type, slice(node, text))
  }
}

function blocksOrPara(children, text) {
  const out = children.map((c) => blockToPm(c, text))
  return out.length ? out : [para([])]
}

function list(node, text) {
  const spread = !!(node.spread || node.children.some((li) => li.spread))
  const task = node.children.some((li) => typeof li.checked === 'boolean')
  // 체크 상자가 있는 항목과 없는 항목이 섞인 목록도 흔하다. 없는 항목은 checked=null 로
  // 두어 상자를 그리지 않는다 — 안 그러면 저장할 때 모든 항목에 `[ ]` 가 붙는다
  const items = node.children.map((li) => {
    const content = li.children.map((c) => blockToPm(c, text))
    // Tiptap 의 목록 항목은 문단으로 시작해야 한다
    if (!content.length || content[0].type !== 'paragraph') content.unshift(para([]))
    return task
      ? { type: 'taskItem', attrs: { checked: typeof li.checked === 'boolean' ? li.checked : null }, content }
      : { type: 'listItem', content }
  })
  if (task) return { type: 'taskList', attrs: { spread }, content: items }
  if (node.ordered) return { type: 'orderedList', attrs: { start: node.start ?? 1, spread }, content: items }
  return { type: 'bulletList', attrs: { spread }, content: items }
}

function table(node, text) {
  // 열 수는 머리줄이 정한다. 그보다 많은 칸은 GFM 이 버린다(화면에 안 나온다)
  const width = node.children[0]?.children.length ?? 0
  const rows = node.children.map((row, r) => {
    const cells = row.children.slice(0, width).map((cell) => ({
      type: r === 0 ? 'tableHeader' : 'tableCell',
      content: [para(inlineToPm(cell.children, text, [], { inTable: true }))],
    }))
    // 칸이 모자란 줄을 미리 채운다. 안 채우면 prosemirror-tables 가 열 때 고쳐서
    // 손대지도 않은 표가 "고친 것" 이 된다
    while (cells.length < width) cells.push({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [para([])] })
    return { type: 'tableRow', content: cells }
  })
  return { type: 'table', attrs: { align: node.align ?? [], ...tableStyle(slice(node, text)) }, content: rows }
}

/**
 * 표를 고쳤을 때 원래 모양으로 다시 쓰려고 적어 둔다. 칸 하나 고쳤다고 표 전체를
 * 공백으로 줄 맞춤하면 diff 가 표 전체가 된다.
 *   pipeAlign — 줄마다 `|` 자리가 맞춰져 있었나
 *   padding   — `| 칸 |` 처럼 칸 안쪽에 공백이 있었나
 */
function tableStyle(src) {
  const lines = src.split(/\r?\n/).map((l) => l.trimEnd())
  return {
    pipeAlign: lines.length > 2 && lines.every((l) => displayWidth(l) === displayWidth(lines[0])),
    padding: /(^\s*\| )|( \| )/.test(lines[0]),
  }
}
