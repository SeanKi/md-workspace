import React, { useState } from 'react'

/*
 * 처음 만난 문서의 방향 고르기 — 로컬과 원격 양쪽에 있는데 **함께 맞춘 적이 없어** 공통 조상이 없는 문서.
 * 한 번이라도 맞춘 문서는 블록 단위로 알아서 합치므로 여기 오지 않는다 (sync-core engine.js `contact`).
 *
 *   ⬆ 내 것   — 이 기기의 내용이 맞다. 원격 것을 덮는다
 *   ⬇ 원격 것 — 원격 내용이 맞다. 이 기기의 것을 덮는다 (덮이는 판은 원격 이력에 남지 않으니 신중히)
 *   ⇅ 합치기  — 같은 블록은 하나로, 다른 블록은 양쪽 다 남긴다 (예전 동작)
 *   나중에    — 고르지 않고 둔다. 그 문서는 고를 때까지 맞추지 않는다
 */

const MODES = [
  ['up', '⬆ 내 것'],
  ['down', '⬇ 원격 것'],
  ['merge', '⇅ 합치기'],
  ['', '나중에'],
]

export default function PendingDialog({ repo, files, onApply, onCancel }) {
  const [pick, setPick] = useState(() => Object.fromEntries(files.map((f) => [f, ''])))
  const [busy, setBusy] = useState(false)
  const all = (mode) => setPick(Object.fromEntries(files.map((f) => [f, mode])))
  const chosen = Object.values(pick).filter(Boolean).length

  const apply = async () => {
    setBusy(true)
    try {
      const by = { up: [], down: [], merge: [] }
      for (const [f, m] of Object.entries(pick)) if (m) by[m].push(f)
      await onApply(by)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-back">
      <div className="modal pending-dialog">
        <div className="modal-title">방향 고르기 — {repo.name}</div>
        <p className="modal-body">
          아래 문서는 <b>이 기기와 원격 양쪽에 있는데 함께 맞춘 적이 없어</b> 어느 쪽이 맞는지 알 수 없습니다.
          한 번 맞춘 뒤로는 블록(문단) 단위로 알아서 합칩니다.
        </p>
        <div className="pending-all">
          모두:
          {MODES.map(([m, label]) => <button key={m || 'later'} type="button" onClick={() => all(m)}>{label}</button>)}
        </div>
        <div className="pending-list">
          {files.map((f) => (
            <div key={f} className="pending-row">
              <span className="pending-path" title={f}>{f}</span>
              <span className="pending-modes">
                {MODES.map(([m, label]) => (
                  <label key={m || 'later'} className={pick[f] === m ? 'on' : ''}>
                    <input type="radio" name={f} checked={pick[f] === m} onChange={() => setPick((p) => ({ ...p, [f]: m }))} />
                    {label}
                  </label>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="hint">⬇ 원격 것을 고르면 이 기기의 내용이 바뀝니다 — 바뀌기 전 내용은 git 을 쓰는 저장소면 이력에서 되찾을 수 있습니다.</div>
        <div className="modal-row">
          <span className="spacer" />
          <button type="button" onClick={onCancel}>닫기</button>
          <button type="button" className="primary" disabled={!chosen || busy} onClick={apply}>{chosen}개 맞추기</button>
        </div>
      </div>
    </div>
  )
}
