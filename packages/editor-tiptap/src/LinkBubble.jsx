import React, { useEffect, useRef, useState } from 'react'
import { useEditorState } from '@tiptap/react'
import { wikiAt, followWiki } from './wikilinks.js'
import { follow } from './links.js'

/*
 * 링크 풍선. 커서가 링크 위에 있으면 링크 아래에 뜬다 (MDXEditor 의 링크 대화상자 자리).
 *
 * - 주소를 누르면 따라간다 (본문에서는 Ctrl+누르기 — links.js)
 * - [편집] 주소 고치기 · [해제] 링크만 걷기
 * - 툴바 🔗 는 이 풍선을 입력 상태로 연다. `window.prompt` 는 Tauri 창에서 뜨지 않을 수 있다
 */

const keep = (e) => e.preventDefault()

export default function LinkBubble({ editor, ctxRef, request, onDone }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      href: e.isActive('link') ? e.getAttributes('link').href ?? '' : null,
      from: e.state.selection.from,
      empty: e.state.selection.empty,
      wiki: e.state.selection.empty ? wikiAt(e.state, e.state.selection.from) : null,
    }),
  })
  const [editing, setEditing] = useState(false)
  // 포커스는 트랜잭션이 아니라서 useEditorState 로는 안 바뀐다 — 직접 듣는다
  const [focused, setFocused] = useState(editor.isFocused)
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    editor.on('focus', on)
    editor.on('blur', off)
    return () => { editor.off('focus', on); editor.off('blur', off) }
  }, [editor])
  const [value, setValue] = useState('')
  const input = useRef(null)
  const box = useRef(null)

  // 툴바에서 🔗 를 누르면 입력 상태로 연다
  useEffect(() => {
    if (!request) return
    setValue(editor.getAttributes('link').href ?? '')
    setEditing(true)
  }, [request, editor])

  useEffect(() => { if (editing) setTimeout(() => input.current?.select(), 0) }, [editing])

  const show = editing || ((s.href !== null || s.wiki) && focused)
  if (!show) return null

  // 자리: 커서(또는 고른 곳 시작)의 바로 아래. 편집기 상자 기준이라 스크롤을 따라간다
  const host = editor.view.dom.closest('.tt-editor')
  let left = 0
  let top = 0
  try {
    const c = editor.view.coordsAtPos(s.from)
    const h = host.getBoundingClientRect()
    left = Math.max(8, Math.min(c.left - h.left, h.width - 340))
    top = c.bottom - h.top + 6
  } catch { /* 문서가 바뀌는 중 — 다음 그리기에서 맞춘다 */ }

  const close = () => { setEditing(false); onDone?.(); editor.commands.focus() }
  const apply = () => {
    const href = value.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!href) chain.unsetLink().run()
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      // 고른 글자가 없으면 주소를 글자로 넣는다
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else chain.setLink({ href }).run()
    setEditing(false)
    onDone?.()
  }

  return (
    <div className="tt-link-bubble" ref={box} style={{ left, top }} onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') keep(e) }}>
      {!editing && s.wiki && s.href === null ? (
        <>
          <span className="wiki-tag">내부 링크</span>
          <a href="#" title="열기" onClick={(e) => { e.preventDefault(); followWiki(s.wiki.name + (s.wiki.heading ? `#${s.wiki.heading}` : ''), ctxRef?.current, editor) }}>
            {s.wiki.name || '이 문서'}{s.wiki.heading ? ` › ${s.wiki.heading}` : ''}
          </a>
          <button type="button" onClick={() => followWiki(s.wiki.name + (s.wiki.heading ? `#${s.wiki.heading}` : ''), ctxRef?.current, editor)}>열기</button>
        </>
      ) : editing ? (
        <>
          <input ref={input} value={value} placeholder="주소 또는 다른글.md · #제목" spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); apply() }
              else if (e.key === 'Escape') { e.preventDefault(); close() }
            }} />
          <button type="button" onClick={apply}>확인</button>
          <button type="button" onClick={close}>취소</button>
        </>
      ) : (
        <>
          <a href={s.href} title="따라가기" onClick={(e) => { e.preventDefault(); follow(s.href, ctxRef?.current, editor) }}>{s.href || '(빈 주소)'}</a>
          <button type="button" onClick={() => { setValue(s.href); setEditing(true) }}>편집</button>
          <button type="button" onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>해제</button>
        </>
      )}
    </div>
  )
}
