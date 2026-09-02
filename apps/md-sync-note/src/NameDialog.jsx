import React, { useEffect, useRef, useState } from 'react'

/**
 * 이름을 받는 작은 창. 새 폴더 · 새 노트 · 이름 바꾸기가 함께 쓴다.
 *
 * Tauri 의 대화상자에는 글자를 받는 것이 없어서 직접 만든다.
 * 이름 바꾸기일 때는 확장자를 뺀 부분만 선택해 둔다 — 대개 그 부분만 고친다.
 */
export default function NameDialog({ title, value = '', okLabel = '확인', check, onOk, onCancel }) {
  const [text, setText] = useState(value)
  const [error, setError] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, [value])

  const submit = () => {
    const r = check ? check(text) : { name: text.trim() }
    if (r.error) { setError(r.error); return }
    onOk(r.name)
  }

  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-title">{title}</div>
        <input
          ref={ref}
          className="modal-input"
          value={text}
          onChange={(e) => { setText(e.target.value); setError('') }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-buttons">
          <button className="primary" onClick={submit}>{okLabel}</button>
          <button onClick={onCancel}>취소</button>
        </div>
      </div>
    </div>
  )
}
