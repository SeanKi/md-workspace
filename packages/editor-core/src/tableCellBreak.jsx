import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $applyNodeReplacement, $getSelection, $isRangeSelection, LineBreakNode,
  COMMAND_PRIORITY_BEFORE_CRITICAL, KEY_ENTER_COMMAND,
} from 'lexical'
import {
  addExportVisitor$, addImportVisitor$, addLexicalNode$,
  addTableCellEditorChild$, realmPlugin,
} from '@mdxeditor/editor'

// 표 셀 안에서 Alt+Enter 로 줄바꿈.
//
// GFM 표는 셀 안에 진짜 개행을 담지 못한다. 그래서 마크다운에는 `<br />` 로 적는다
// (GitHub·VS Code·Obsidian 모두 알아본다). 반대로 lexical 쪽에서는 `<br />` 를
// MDXEditor 기본값인 GenericHTMLNode(빈 인라인 요소)로 두면 안 된다 — 자식이 없어서
// 커서가 뒤에 서질 못하고, 이어 친 글자가 줄바꿈 위쪽으로 들어간다.
// LineBreakNode 를 상속한 전용 노드로 다루면 커서는 lexical 이 알아서 처리한다.
//
// 타입을 따로 파는 이유: 그냥 LineBreakNode 로 두면 Shift+Enter 로 만든 기존
// 줄바꿈까지 전부 `<br />` 로 다시 쓰여 건드리지도 않은 문서가 바뀐다.

const BR_TYPE = 'md-html-br'

class HtmlBreakNode extends LineBreakNode {
  static getType() { return BR_TYPE }
  static clone(node) { return new HtmlBreakNode(node.__key) }
  static importJSON(serialized) { return $createHtmlBreakNode().updateFromJSON(serialized) }
  // 붙여넣기로 들어온 <br> 은 평범한 LineBreakNode 로 두고 이 노드는 건드리지 않는다
  static importDOM() { return null }
}

function $createHtmlBreakNode() {
  return $applyNodeReplacement(new HtmlBreakNode())
}

function $isHtmlBreakNode(node) {
  return node instanceof HtmlBreakNode
}

// 마크다운의 `<br />` → HtmlBreakNode. 우선순위를 올려 두지 않으면 MDXEditor 의
// 일반 HTML 처리(GenericHTMLNode)가 먼저 집어간다.
const HtmlBreakImportVisitor = {
  testNode: (node) => node.type === 'mdxJsxTextElement' && node.name === 'br',
  visitNode: ({ lexicalParent }) => { lexicalParent.append($createHtmlBreakNode()) },
  priority: 1,
}

// HtmlBreakNode → `<br />`. $isLineBreakNode 가 상속 노드까지 참이라
// 코어의 LineBreak 방문자와 겹친다. 우선순위로 이쪽이 이긴다.
const HtmlBreakExportVisitor = {
  testLexicalNode: $isHtmlBreakNode,
  visitLexicalNode: ({ mdastParent, actions }) => {
    actions.appendToParent(mdastParent, {
      type: 'mdxJsxTextElement', name: 'br', attributes: [], children: [],
    })
  },
  priority: 1,
}

// 셀 하나하나가 독립된 lexical 에디터다. MDXEditor 가 Enter 를 CRITICAL 로 가로채
// "아래 셀로 이동" 에 쓰므로, 같은 큐의 맨 앞에 꽂히는 BEFORE_CRITICAL 로 등록해
// Alt+Enter 만 먼저 낚아챈다.
function TableCellAltEnter() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
    if (!event?.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false
    event.preventDefault()

    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return false
    selection.insertNodes([$createHtmlBreakNode()])
    return true
  }, COMMAND_PRIORITY_BEFORE_CRITICAL), [editor])

  return null
}

export const tableCellBreakPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addLexicalNode$]: HtmlBreakNode,
      [addImportVisitor$]: HtmlBreakImportVisitor,
      [addExportVisitor$]: HtmlBreakExportVisitor,
      [addTableCellEditorChild$]: TableCellAltEnter,
    })
  },
})
