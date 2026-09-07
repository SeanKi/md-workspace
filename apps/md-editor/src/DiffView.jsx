import React, { useMemo } from 'react'
import { buildRows } from './diffRows.js'

const MAX_ROWS = 80   // 너무 길면 창이 화면을 넘는다

/** 저장 전에 "내 것"과 "파일에 있는 것"을 좌우로 세워 보여준다. */
export default function DiffView({ mine, theirs }) {
  const { rows, added, removed } = useMemo(() => buildRows(mine, theirs), [mine, theirs])

  if (added === 0 && removed === 0) {
    return <div className="diff empty">글자는 같고 줄바꿈·공백만 다릅니다.</div>
  }

  const shown = rows.slice(0, MAX_ROWS)

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="del">내 편집 −{removed}줄</span>
        <span className="add">파일 원본 +{added}줄</span>
      </div>

      {/* 네 칸짜리 격자 하나에 두 쪽을 다 담는다. 그래야 줄 높이가 저절로 맞는다 */}
      <div className="diff-grid">
        <div className="diff-col-head left">내가 고친 것</div>
        <div className="diff-col-head right">파일 원본</div>

        {shown.map((r, i) => (
          r.kind === 'gap'
            ? <div key={i} className="diff-gap">{r.text}</div>
            : (
              <React.Fragment key={i}>
                <div className={`diff-no left ${r.kind}`}>{r.ln ?? ''}</div>
                <div className={`diff-cell left ${r.kind}${r.left === null ? ' blank' : ''}`}>
                  {r.left ?? ''}
                </div>
                <div className={`diff-no right ${r.kind}`}>{r.rn ?? ''}</div>
                <div className={`diff-cell right ${r.kind}${r.right === null ? ' blank' : ''}`}>
                  {r.right ?? ''}
                </div>
              </React.Fragment>
            )
        ))}

        {rows.length > shown.length && (
          <div className="diff-gap">⋯ 이 아래로 {rows.length - shown.length}줄 더</div>
        )}
      </div>
    </div>
  )
}
