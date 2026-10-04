import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { cellAround, TableMap } from '@tiptap/pm/tables'

/*
 * 표 칸 안의 키.
 *
 * - **Enter** — 아래 칸으로 (마지막 줄이면 줄을 하나 더한다). 칸은 한 문단뿐이라
 *   문단을 나눌 수 없다 (extensions.js)
 * - **Shift/Alt+Enter** — 칸 안 줄바꿈. 파일에는 `<br />` 로 나간다 (GFM 표는 개행을
 *   못 담는다 — CLAUDE.md "표 셀 안의 줄바꿈")
 */

function cellBelow(state) {
  const $cell = cellAround(state.selection.$head)
  if (!$cell) return null
  const table = $cell.node(-1)
  const start = $cell.start(-1)
  const map = TableMap.get(table)
  const rect = map.findCell($cell.pos - start)
  if (rect.bottom >= map.height) return { last: true }
  return { pos: start + map.map[rect.bottom * map.width + rect.left] }
}

function moveDown(editor) {
  const below = cellBelow(editor.state)
  if (!below) return false
  if (below.last) {
    editor.chain().addRowAfter().run()
    const again = cellBelow(editor.state)
    if (!again?.pos) return true
    below.pos = again.pos
  }
  const { state, view } = editor
  view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(below.pos + 1))).scrollIntoView())
  return true
}

function cellBreak(editor) {
  if (!cellAround(editor.state.selection.$head)) return false
  const type = editor.schema.nodes.hardBreak
  const { state, view } = editor
  view.dispatch(state.tr.replaceSelectionWith(type.create({ kind: 'html' })).scrollIntoView())
  return true
}

export const tableKeys = Extension.create({
  name: 'tableKeys',
  // HardBreak · 목록의 Enter 보다 먼저 받는다
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Enter: () => moveDown(this.editor),
      'Shift-Enter': () => cellBreak(this.editor),
      'Alt-Enter': () => cellBreak(this.editor),
    }
  },
})
