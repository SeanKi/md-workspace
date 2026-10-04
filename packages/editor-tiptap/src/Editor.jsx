import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import { Step } from '@tiptap/pm/transform'
import { parseMarkdown, bindOrigin, serializeDoc } from '@md/md-bridge'
import { buildExtensions } from './extensions.js'
import CodeBlockView from './CodeBlockView.jsx'
import { imageView, handleImagePaste, handleImageDrop } from './images.js'
import { attachLinkClicks, watchCtrl } from './links.js'
import LinkBubble from './LinkBubble.jsx'
import { revealIn } from './reveal.js'
import Toolbar from './Toolbar.jsx'

/*
 * Tiptap(ProseMirror) 편집기 한 화면.
 *
 * - 문서를 바꿀 때는 `key=` 로 다시 마운트한다 (CLAUDE.md "문서 전환은 key= 로")
 * - 글자마다 마크다운을 만들지 않는다. 저장할 때 `getMarkdown()` 이 한 번 만든다.
 *   MDXEditor 는 글자마다 문서 전체를 다시 써서 268KB 에서 한 글자 0.59초였다
 * - 손대지 않은 블록은 원문 그대로 나간다 (md-bridge/serialize.js)
 * - 창 나누기: 이 화면의 편집 단계(step)를 `onSteps` 로 내보내고, 반대쪽 단계는
 *   `applySteps` 로 받는다 (SplitEditor.jsx)
 */

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
const MIRROR = 'md-mirror'

const TiptapEditor = forwardRef(function TiptapEditor(
  { markdown, ctxRef, onDirty, onSteps, onError, toolbarExtra, docJSON }, ref,
) {
  const parsed = useMemo(() => parseMarkdown(markdown ?? ''), [markdown])
  const originRef = useRef(null)
  const cb = useRef({})
  cb.current = { onDirty, onSteps, onError, onLinkKey: () => setLinkReq((n) => n + 1) }

  const extensions = useMemo(() => buildExtensions({
    codeBlock: () => ReactNodeViewRenderer(CodeBlockView),
    image: imageView(() => ctxRef?.current),
  }), [ctxRef])

  const editor = useEditor({
    extensions,
    // 창을 나눌 때 아래 화면은 위 화면의 **지금 문서**를 그대로 받는다 (구조가 같아야 편집 단계가 맞는다)
    content: docJSON ?? (parsed.blocks.length ? { type: 'doc', content: parsed.blocks.map((b) => b.json) } : emptyDoc),
    // 글자마다 React 를 다시 그리지 않는다. 툴바는 useEditorState 로 필요한 것만 본다
    shouldRerenderOnTransaction: false,
    immediatelyRender: true,
    // 스키마에 맞지 않는 내용이면 알려 준다 — 앱이 원본 모드로 연다
    enableContentCheck: true,
    onContentError: ({ error }) => cb.current.onError?.({ error }),
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'false' },
      handlePaste: (view, event) => handleImagePaste(view, event, ctxRef?.current),
      handleDrop: (view, event) => handleImageDrop(view, event, ctxRef?.current),
      // Ctrl+K — 링크 넣기·고치기 (링크 풍선을 입력 상태로)
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          cb.current.onLinkKey?.()
          return true
        }
        return false
      },
    },
    onTransaction: ({ transaction: tr }) => {
      if (!tr.docChanged) return
      cb.current.onDirty?.()
      if (!tr.getMeta(MIRROR)) cb.current.onSteps?.(tr.steps.map((s) => s.toJSON()))
    },
  }, [parsed, extensions])

  // 편집기가 생기자마자(아직 아무도 고치기 전에) 원문과 묶는다. 이 순간의 최상위
  // 블록 객체들이 "손대지 않은 블록" 의 기준이다. 편집기가 새로 만들어지면 다시 묶는다
  if (editor && !originRef.current?.has(editor)) {
    originRef.current = new WeakMap([[editor, bindOrigin(editor.state.doc, parsed, editor.schema)]])
  }
  const origin = () => originRef.current?.get(editor)

  useEffect(() => watchCtrl(), [])
  useEffect(() => (editor ? attachLinkClicks(editor.view, () => ctxRef?.current, () => editor) : undefined), [editor, ctxRef])
  // 툴바 🔗 가 링크 풍선을 입력 상태로 연다 (숫자를 올려 알린다)
  const [linkReq, setLinkReq] = useState(0)

  useImperativeHandle(ref, () => ({
    editor,
    /** 저장할 마크다운. 손대지 않은 블록은 원문 그대로 */
    getMarkdown: () => serializeDoc(editor.state.doc, parsed, origin()).text,
    /**
     * 반대쪽 화면의 편집 단계를 그대로 적용한다. 스키마 객체가 화면마다 따로라
     * JSON 으로 건너온다. 되돌리기 이력에는 넣지 않는다 — 각 화면은 자기가 한 것만 되돌린다
     */
    applySteps: (steps) => {
      const tr = editor.state.tr
      for (const s of steps) tr.step(Step.fromJSON(editor.schema, s))
      tr.setMeta(MIRROR, true).setMeta('addToHistory', false)
      editor.view.dispatch(tr)
    },
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
    /** 제목·글자 자리로 데려간다 (reveal.js) */
    reveal: (target) => revealIn(editor, target),
  }), [editor, parsed, markdown])

  return (
    <div className="tt-editor">
      <Toolbar editor={editor} ctxRef={ctxRef} extra={toolbarExtra} onLink={() => setLinkReq((n) => n + 1)} />
      <EditorContent editor={editor} />
      <LinkBubble editor={editor} ctxRef={ctxRef} request={linkReq} />
    </div>
  )
})

export default TiptapEditor
