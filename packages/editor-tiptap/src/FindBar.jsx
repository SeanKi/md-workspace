import React, { useEffect, useRef, useState } from 'react'
import { setQuery, step, findState, clearFind } from './find.js'

/*
 * Ctrl+F 찾기 줄. **오른쪽 본문 안에서만** 찾는다 (저장소 전체 검색은 왼쪽 검색 칸).
 * 위지윅에서는 편집기 꾸밈으로 칠하고(find.js), 원본 모드에서는 글 상자 안에서 찾는다.
 *
 *   Enter 다음 · Shift+Enter 이전 · Esc 닫기
 */

function textMatches(value, query) {
  const out = []
  if (!query) return out
  const hay = value.toLowerCase()
  const want = query.toLowerCase()
  for (let i = hay.indexOf(want); i >= 0; i = hay.indexOf(want, i + want.length)) out.push(i)
  return out
}

export default function FindBar({ getEditor, getTextarea, initial, onClose }) {
  const [query, setQ] = useState(initial ?? '')
  const [count, setCount] = useState({ at: 0, total: 0 })
  const input = useRef(null)
  const textAt = useRef(-1)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])

  const refresh = () => {
    const ed = getEditor()
    if (ed) {
      const s = findState(ed)
      setCount({ at: s.index + 1, total: s.matches.length })
    }
  }

  // 원본 모드: 글 상자에서 찾아 그 자리를 고른다
  const findInText = (dir, q = query) => {
    const ta = getTextarea()
    if (!ta) return
    const hits = textMatches(ta.value, q)
    if (!hits.length) { setCount({ at: 0, total: 0 }); return }
    const cur = ta.selectionStart
    let i
    if (dir === 0) i = Math.max(0, hits.findIndex((h) => h >= cur))
    else i = ((textAt.current < 0 ? 0 : textAt.current) + dir + hits.length) % hits.length
    textAt.current = i
    ta.focus()
    ta.setSelectionRange(hits[i], hits[i] + q.length)
    // 글 상자는 고른 자리로 스스로 굴러가지 않는다 — 줄 수로 어림해 옮긴다
    const line = ta.value.slice(0, hits[i]).split('\n').length
    ta.scrollTop = Math.max(0, (line - 5) * parseFloat(getComputedStyle(ta).lineHeight || '20'))
    input.current?.focus()
    setCount({ at: i + 1, total: hits.length })
  }

  const change = (q) => {
    setQ(q)
    textAt.current = -1
    const ed = getEditor()
    if (ed) { setQuery(ed, q); refresh() } else findInText(0, q)
  }

  const go = (dir) => {
    const ed = getEditor()
    if (ed) { step(ed, dir); refresh() } else findInText(dir)
  }

  // 처음 열 때 고른 글자가 있으면 그것으로 바로 찾는다
  useEffect(() => { if (initial) change(initial) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { clearFind(getEditor()); onClose() }

  return (
    <div className="tt-findbar" onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }}>
      <input ref={input} value={query} placeholder="문서에서 찾기" spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); close() }
        }} />
      <span className="count">{query ? (count.total ? `${count.at}/${count.total}` : '없음') : ''}</span>
      <button type="button" title="이전 (Shift+Enter)" onClick={() => go(-1)}>↑</button>
      <button type="button" title="다음 (Enter)" onClick={() => go(1)}>↓</button>
      <button type="button" title="닫기 (Esc)" onClick={close}>✕</button>
    </div>
  )
}
