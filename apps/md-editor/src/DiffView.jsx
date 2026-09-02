import React, { useMemo } from 'react'
import { diffLines } from 'diff'

const MAX_ROWS = 60          // 너무 길면 창이 화면을 넘는다
const CONTEXT = 2            // 바뀐 줄 앞뒤로 보여줄 줄 수

/**
 * 두 글을 줄 단위로 비교해 바뀐 곳만 보여준다.
 *
 * 바뀌지 않은 부분은 앞뒤 두 줄만 남기고 접는다. 문서 전체를 늘어놓으면
 * 정작 무엇이 달라졌는지 찾기 어렵다.
 */
export default function DiffView({ mine, theirs }) {
  const { rows, added, removed } = useMemo(() => {
    const parts = diffLines(mine ?? '', theirs ?? '')
    const rows = []
    let added = 0
    let removed = 0

    parts.forEach((part, i) => {
      const lines = part.value.replace(/\n$/, '').split('\n')
      if (part.added || part.removed) {
        const kind = part.added ? 'add' : 'del'
        if (part.added) added += lines.length
        else removed += lines.length
        lines.forEach((text) => rows.push({ kind, text }))
        return
      }
      // 그대로인 부분 — 앞뒤 문맥만 남기고 접는다
      const head = i === 0 ? [] : lines.slice(0, CONTEXT)
      const tail = i === parts.length - 1 ? [] : lines.slice(-CONTEXT)
      const hidden = lines.length - head.length - tail.length
      head.forEach((text) => rows.push({ kind: 'same', text }))
      if (hidden > 0) rows.push({ kind: 'gap', text: `⋯ ${hidden}줄 생략` })
      tail.forEach((text) => rows.push({ kind: 'same', text }))
    })
    return { rows, added, removed }
  }, [mine, theirs])

  if (added === 0 && removed === 0) {
    return <div className="diff empty">글자는 같고 줄바꿈·공백만 다릅니다.</div>
  }

  const shown = rows.slice(0, MAX_ROWS)

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="add">+{added}줄</span>
        <span className="del">−{removed}줄</span>
        <span className="diff-legend">＋ 파일에 있는 줄 · − 내 편집에만 있는 줄</span>
      </div>
      <div className="diff-body">
        {shown.map((r, i) => (
          <div key={i} className={'diff-line ' + r.kind}>
            <span className="mark">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>
            <span className="text">{r.text || ' '}</span>
          </div>
        ))}
        {rows.length > shown.length && (
          <div className="diff-line gap">
            <span className="mark"> </span>
            <span className="text">⋯ 이 아래로 {rows.length - shown.length}줄 더</span>
          </div>
        )}
      </div>
    </div>
  )
}
