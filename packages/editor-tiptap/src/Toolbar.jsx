import React from 'react'
import { useEditorState } from '@tiptap/react'
import { pickImages } from './images.js'
import ColorButton from './ColorButton.jsx'
import TableTools from './TableTools.jsx'

/*
 * 툴바. 상태(굵게가 켜졌나 등)는 `useEditorState` 로 고른 것만 구독한다 — 글자 하나마다
 * 툴바 전체를 다시 그리지 않게 (CLAUDE.md "편집 중인 내용은 상태가 아니라 ref 에").
 *
 * 단추는 `onMouseDown` 에서 기본 동작을 막는다. 누르는 순간 본문이 포커스를 잃으면
 * 한글 조합 중이던 글자가 끊긴다.
 */

const keep = (e) => e.preventDefault()

function Btn({ on, title, onClick, children, disabled }) {
  return (
    <button type="button" className={on ? 'on' : ''} title={title} aria-label={title}
      disabled={disabled} onMouseDown={keep} onClick={onClick}>
      {children}
    </button>
  )
}

const BLOCKS = [
  ['p', '본문'], ['1', '제목 1'], ['2', '제목 2'], ['3', '제목 3'], ['4', '제목 4'],
]

export default function Toolbar({ editor, ctxRef, extra, onLink }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'),
      strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), table: e.isActive('table'),
      block: [1, 2, 3, 4].find((l) => e.isActive('heading', { level: l }))?.toString() ?? 'p',
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  })
  const c = () => editor.chain().focus()

  const setBlock = (v) => (v === 'p' ? c().setParagraph().run() : c().setHeading({ level: Number(v) }).run())

  return (
    <div className="tt-toolbar" onMouseDown={(e) => { if (e.target.tagName !== 'SELECT') keep(e) }}>
      <Btn title="되돌리기 (Ctrl+Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}>↶</Btn>
      <Btn title="다시 하기 (Ctrl+Y)" disabled={!s.canRedo} onClick={() => c().redo().run()}>↷</Btn>
      <span className="sep" />
      <Btn title="굵게 (Ctrl+B)" on={s.bold} onClick={() => c().toggleBold().run()}><b>B</b></Btn>
      <Btn title="기울임 (Ctrl+I)" on={s.italic} onClick={() => c().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="밑줄 (Ctrl+U)" on={s.underline} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
      <Btn title="취소선" on={s.strike} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
      <Btn title="인라인 코드" on={s.code} onClick={() => c().toggleCode().run()}>{'</>'}</Btn>
      <ColorButton editor={editor} kind="color" />
      <ColorButton editor={editor} kind="backgroundColor" />
      <span className="sep" />
      <select value={s.block} title="문단 종류" onChange={(e) => setBlock(e.target.value)}>
        {BLOCKS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <Btn title="글머리 목록" on={s.bullet} onClick={() => c().toggleBulletList().run()}>•≡</Btn>
      <Btn title="번호 목록" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>1.≡</Btn>
      <Btn title="할 일 목록" on={s.task} onClick={() => c().toggleTaskList().run()}>☑</Btn>
      <Btn title="인용" on={s.quote} onClick={() => c().toggleBlockquote().run()}>❝</Btn>
      <span className="sep" />
      <Btn title="링크 (Ctrl+K)" on={s.link} onClick={onLink}>🔗</Btn>
      <Btn title="표 넣기" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Btn>
      <Btn title="이미지 넣기" onClick={() => pickImages(editor.view, ctxRef?.current)}>🖼</Btn>
      <Btn title="코드블록" onClick={() => c().toggleCodeBlock().run()}>{'{ }'}</Btn>
      <Btn title="Mermaid 다이어그램" onClick={() => c().setCodeBlock({ language: 'mermaid' }).run()}>◇</Btn>
      <Btn title="구분선" onClick={() => c().setHorizontalRule().run()}>―</Btn>
      {s.table && <TableTools editor={editor} />}
      {extra && <><span className="grow" />{extra}</>}
    </div>
  )
}
