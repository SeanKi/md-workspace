import React, { useEffect, useRef, useState } from 'react'

/*
 * 글자색 · 배경색. 파일에는 `<span style="color:…">` 로 나간다 (MDXEditor 때와 같은 모양 —
 * VS Code 미리보기·Obsidian 은 보여 주고 GitHub 은 style 을 지운다).
 * Word 처럼 나뉜 단추: 왼쪽은 마지막 색을 바로 칠하고, 오른쪽 ▾ 가 고르기.
 */

const PALETTE = {
  color: [
    ['#e11d48', '빨강'], ['#ea580c', '주황'], ['#ca8a04', '노랑'], ['#16a34a', '초록'],
    ['#2563eb', '파랑'], ['#7c3aed', '보라'], ['#6b7280', '회색'],
  ],
  backgroundColor: [
    ['#fef08a', '노랑'], ['#bbf7d0', '초록'], ['#bfdbfe', '파랑'], ['#fecaca', '빨강'],
    ['#e9d5ff', '보라'], ['#e5e7eb', '회색'],
  ],
}

const keep = (e) => e.preventDefault()

export default function ColorButton({ editor, kind }) {
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState(PALETTE[kind][0][0])
  const ref = useRef(null)
  const isText = kind === 'color'

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const apply = (value) => {
    const chain = editor.chain().focus()
    if (isText) (value ? chain.setColor(value) : chain.unsetColor()).run()
    else (value ? chain.setBackgroundColor(value) : chain.unsetBackgroundColor()).run()
    // 색이 다 빠진 textStyle 표시는 남기지 않는다 (빈 span 이 생긴다)
    editor.chain().removeEmptyTextStyle().run()
    if (value) setLast(value)
    setOpen(false)
  }

  return (
    <span className="tt-color" ref={ref}>
      <button type="button" title={isText ? '글자색' : '배경색'} aria-label={isText ? '글자색' : '배경색'}
        onMouseDown={keep} onClick={() => apply(last)}>
        <span className="glyph">{isText ? 'A' : '▇'}</span>
        <i style={{ background: last }} />
      </button>
      <button type="button" className="drop" title="색 고르기" onMouseDown={keep} onClick={() => setOpen((v) => !v)}>▾</button>
      {open && (
        <div className="tt-color-pop" onMouseDown={keep}>
          {PALETTE[kind].map(([c, name]) => (
            <button key={c} type="button" title={name} style={{ background: c }} onClick={() => apply(c)} />
          ))}
          <button type="button" className="none" title="색 지우기" onClick={() => apply(null)}>✕</button>
        </div>
      )}
    </span>
  )
}
