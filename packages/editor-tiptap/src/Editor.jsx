import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import { parseMarkdown, bindOrigin, serializeDoc } from '@md/md-bridge'
import { buildExtensions } from './extensions.js'
import CodeBlockView from './CodeBlockView.jsx'
import { imageView, handleImagePaste, handleImageDrop } from './images.js'
import { handleLinkClick, watchCtrl } from './links.js'
import Toolbar from './Toolbar.jsx'

/*
 * Tiptap(ProseMirror) 편집기.
 *
 * - 문서를 바꿀 때는 `key=` 로 다시 마운트한다 (CLAUDE.md "문서 전환은 key= 로")
 * - 글자마다 마크다운을 만들지 않는다. 저장할 때 `getMarkdown()` 이 한 번 만든다.
 *   MDXEditor 는 글자마다 문서 전체를 다시 써서 268KB 에서 한 글자 0.59초였다
 * - 손대지 않은 블록은 원문 그대로 나간다 (md-bridge/serialize.js)
 */

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

const TiptapEditor = forwardRef(function TiptapEditor({ markdown, ctxRef, onDirty }, ref) {
  const parsed = useMemo(() => parseMarkdown(markdown ?? ''), [markdown])
  const originRef = useRef(null)
  const dirtyRef = useRef(onDirty)
  dirtyRef.current = onDirty

  const extensions = useMemo(() => buildExtensions({
    codeBlock: () => ReactNodeViewRenderer(CodeBlockView),
    image: imageView(() => ctxRef?.current),
  }), [ctxRef])

  const editor = useEditor({
    extensions,
    content: parsed.blocks.length ? { type: 'doc', content: parsed.blocks.map((b) => b.json) } : emptyDoc,
    // 글자마다 React 를 다시 그리지 않는다. 툴바는 useEditorState 로 필요한 것만 본다
    shouldRerenderOnTransaction: false,
    immediatelyRender: true,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'false' },
      handlePaste: (view, event) => handleImagePaste(view, event, ctxRef?.current),
      handleDrop: (view, event) => handleImageDrop(view, event, ctxRef?.current),
      handleClick: (view, pos, event) => handleLinkClick(view, pos, event, ctxRef?.current),
    },
    onUpdate: ({ transaction }) => { if (transaction.docChanged) dirtyRef.current?.() },
  }, [parsed, extensions])

  // 편집기가 생기자마자(아직 아무도 고치기 전에) 원문과 묶는다. 이 순간의 최상위
  // 블록 객체들이 "손대지 않은 블록" 의 기준이다. 편집기가 새로 만들어지면 다시 묶는다
  if (editor && !originRef.current?.has(editor)) {
    originRef.current = new WeakMap([[editor, bindOrigin(editor.state.doc, parsed, editor.schema)]])
  }
  const origin = () => originRef.current?.get(editor)

  useEffect(() => watchCtrl(), [])

  useImperativeHandle(ref, () => ({
    editor,
    /** 저장할 마크다운. 손대지 않은 블록은 원문 그대로 */
    getMarkdown: () => serializeDoc(editor.state.doc, parsed, origin()).text,
    /** 왕복 검사용 — 몇 블록이 원문 그대로이고 몇 블록을 새로 쓰는가 */
    getStats: () => {
      const t0 = performance.now()
      const r = serializeDoc(editor.state.doc, parsed, origin())
      const ms = performance.now() - t0
      let raw = 0
      editor.state.doc.descendants((n) => { if (n.type.name === 'rawBlock' || n.type.name === 'rawInline') raw++ })
      return { rewritten: r.rewritten, total: editor.state.doc.childCount, bound: origin()?.bound ?? 0, raw, same: r.text === markdown, ms }
    },
    getTitle: () => {
      let title = ''
      editor.state.doc.forEach((n) => { if (!title && n.type.name === 'heading' && n.attrs.level === 1) title = n.textContent })
      return title
    },
    focus: () => editor.commands.focus(),
  }), [editor, parsed, markdown])

  return (
    <div className="tt-editor">
      <Toolbar editor={editor} ctxRef={ctxRef} />
      <EditorContent editor={editor} />
    </div>
  )
})

export default TiptapEditor
