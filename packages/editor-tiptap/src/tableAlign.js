import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/*
 * GFM 표의 열 정렬(`:--` `:-:` `--:`)을 화면에 그린다. 정렬은 표 노드의 `align` 속성에만
 * 있고(마크다운으로만 오가는 숨은 속성 — extensions.js), 칸마다 꾸밈(decoration)으로 입힌다.
 * 칸 노드에 속성을 넣지 않는 이유: 열을 더하거나 지울 때 칸마다 맞춰 줄 일이 생긴다.
 */

function build(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false
    if (node.type.name !== 'table') return true
    const align = node.attrs.align ?? []
    if (!align.some(Boolean)) return false
    node.forEach((row, rowOff) => {
      let col = 0
      row.forEach((cell, cellOff) => {
        const a = align[col++]
        if (!a) return
        const at = pos + 1 + rowOff + 1 + cellOff
        decos.push(Decoration.node(at, at + cell.nodeSize, { style: `text-align:${a}` }))
      })
    })
    return false
  })
  return DecorationSet.create(doc, decos)
}

const key = new PluginKey('tableAlign')

export const tableAlign = Extension.create({
  name: 'tableAlign',
  addProseMirrorPlugins: () => [new Plugin({
    key,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: { decorations: (state) => key.getState(state) },
  })],
})
