import React, { useMemo } from 'react'
import { buildRows } from './diffRows.js'

/*
 * 좌우 비교. MD Notepad 의 외부 변경 대화상자(md-editor/DiffView.jsx)와 같은 모양이고,
 * 편집기의 "비교" 모드와 외부 변경 대화상자가 함께 쓴다.
 */
export default function DiffView({ mine, theirs, leftLabel = '내가 고친 것', rightLabel = '파일 원본', maxRows = 80, tall = false }) {
  const { rows, added, removed } = useMemo(() => buildRows(mine, theirs), [mine, theirs])

  if (added === 0 && removed === 0) {
    return <div className="diff empty">{mine === theirs ? '달라진 것이 없습니다.' : '글자는 같고 줄바꿈·공백만 다릅니다.'}</div>
  }
  const shown = maxRows ? rows.slice(0, maxRows) : rows

  return (
    <div className={`diff${tall ? ' tall' : ''}`}>
      <div className="diff-head">
        <span className="del">{leftLabel} −{removed}줄</span>
        <span className="add">{rightLabel} +{added}줄</span>
      </div>
      {/* 네 칸짜리 격자 하나에 두 쪽을 다 담는다. 그래야 줄 높이가 저절로 맞는다 */}
      <div className="diff-grid">
        <div className="diff-col-head left">{leftLabel}</div>
        <div className="diff-col-head right">{rightLabel}</div>
        {shown.map((r, i) => (
          r.kind === 'gap'
            ? <div key={i} className="diff-gap">{r.text}</div>
            : (
              <React.Fragment key={i}>
                <div className={`diff-no left ${r.kind}`}>{r.ln ?? ''}</div>
                <div className={`diff-cell left ${r.kind}${r.left === null ? ' blank' : ''}`}>{r.left ?? ''}</div>
                <div className={`diff-no right ${r.kind}`}>{r.rn ?? ''}</div>
                <div className={`diff-cell right ${r.kind}${r.right === null ? ' blank' : ''}`}>{r.right ?? ''}</div>
              </React.Fragment>
            )
        ))}
        {rows.length > shown.length && <div className="diff-gap">⋯ 이 아래로 {rows.length - shown.length}줄 더</div>}
      </div>
    </div>
  )
}
