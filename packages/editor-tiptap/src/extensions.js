import { Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BulletList, OrderedList, TaskList, TaskItem } from '@tiptap/extension-list'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import Code from '@tiptap/extension-code'
import HardBreak from '@tiptap/extension-hard-break'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { tableKeys } from './tableKeys.js'
import { tableAlign } from './tableAlign.js'
import { findExtension } from './find.js'
import { wikiLinks } from './wikilinks.js'

/*
 * 편집기 스키마. 노드 이름은 `md-bridge` 가 만드는 JSON 과 맞아야 한다.
 * React 를 쓰지 않는다 — Node 에서 왕복 시험(`test/roundtrip.mjs`)도 같은 스키마로 돈다.
 * 화면 전용(노드 뷰)은 `views` 로 받아 덧씌운다 (Editor.jsx).
 */

/** 화면에 그리지 않는 속성 — 마크다운으로만 오간다 */
const hidden = (def) => ({ default: def, rendered: false, keepOnSplit: false })

/** 위지윅으로 그릴 수 없는 블록. 원문을 고정폭 글자로 보여 주고 그 자리에서 고친다 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes: () => ({ kind: { default: 'html', parseHTML: (el) => el.dataset.kind, renderHTML: (a) => ({ 'data-kind': a.kind }) } }),
  parseHTML: () => [{ tag: 'pre[data-raw]', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => ['pre', { ...HTMLAttributes, 'data-raw': '', class: 'md-raw' }, ['code', 0]],
})

/** 원문 인라인 조각 (모르는 HTML 태그, 참조 링크 …). 지울 수는 있고 고치지는 못한다 */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ text: { default: '', parseHTML: (el) => el.dataset.raw, renderHTML: (a) => ({ 'data-raw': a.text }) } }),
  parseHTML: () => [{ tag: 'code[data-raw]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['code', { ...HTMLAttributes, class: 'md-raw-inline' }, node.attrs.text],
})

const lowlight = createLowlight(common)

export function buildExtensions(views = {}) {
  const spread = { addAttributes() { return { ...this.parent?.(), spread: hidden(false) } } }
  let codeBlock = CodeBlockLowlight.configure({ lowlight, defaultLanguage: null, HTMLAttributes: {} })
  if (views.codeBlock) codeBlock = codeBlock.extend({ addNodeView: views.codeBlock })
  let image = Image.extend({
    addAttributes() { return { ...this.parent?.(), title: { default: null } } },
  }).configure({ inline: true, allowBase64: false })
  if (views.image) image = image.extend({ addNodeView: views.image })

  return [
    StarterKit.configure({
      codeBlock: false, code: false, hardBreak: false, link: false,
      bulletList: false, orderedList: false,
    }),
    BulletList.extend(spread),
    OrderedList.extend(spread),
    TaskList.extend(spread),
    TaskItem.configure({ nested: true }),
    // 기본 Code 표시는 다른 표시를 모두 밀어낸다(`excludes: '_'`). **굵은 `코드`** 가 사라지면 안 된다
    Code.extend({ excludes: '' }),
    HardBreak.extend({
      addAttributes: () => ({ kind: hidden('backslash'), raw: hidden(null) }),
    }),
    // target=_blank 를 붙이지 않는다 — 붙어 있으면 WebView2 가 Ctrl+누르기를 새 창으로 연다 (links.js)
    Link.extend({
      addAttributes() { return { ...this.parent?.(), title: { default: null } } },
    }).configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { target: null, rel: null } }),
    Table.extend({
      // 새로 만든 표는 줄 맞춤 없이 `| 칸 |` — 칸 하나 고쳐도 그 줄만 바뀐다
      addAttributes() { return { ...this.parent?.(), align: hidden([]), pipeAlign: hidden(false), padding: hidden(true) } },
    }).configure({ resizable: false }),
    TableRow,
    // GFM 표의 칸에는 한 줄 글자만 들어간다. 칸 안에 목록·코드블록을 만들 수 없게 막는다
    TableHeader.extend({ content: 'paragraph' }),
    TableCell.extend({ content: 'paragraph' }),
    tableKeys,
    tableAlign,
    findExtension,
    wikiLinks,
    TextStyle, Color, BackgroundColor,
    image,
    codeBlock,
    RawBlock,
    RawInline,
    ...(views.extra ?? []),
  ]
}
