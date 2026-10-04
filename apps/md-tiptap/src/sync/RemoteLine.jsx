import React from 'react'

/*
 * 저장소 머리의 원격 줄 (GitLine 옆). 원격이 없으면 [원격 연결] 단추만.
 *   ☁ app.koofr.net/…/노트 · 12:30 맞춤 · ↓2 ↑1  [⟳] [⚙]
 */

const short = (url) => {
  try {
    const u = new URL(url)
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean)
    return `${u.host}/${parts.length > 1 ? '…/' : ''}${parts.at(-1) ?? ''}`
  } catch { return url }
}
const time = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent)

export default function RemoteLine({ repo, st, onSync, onSetup, onQr }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn() }
  if (!repo.remote) {
    return (
      <div className="repo-sync">
        <span className="sync-off">원격 없음</span>
        <button onClick={stop(onSetup)}>원격 연결</button>
      </div>
    )
  }
  const cloud = st?.catalog ? st.catalog.filter((c) => !c.cached).length : null
  return (
    <div className="repo-sync" title={`${repo.remote}\n${repo.user}`}>
      <span className={st?.error ? 'sync-err' : 'sync-on'}>☁ {short(repo.remote)}</span>
      {st?.busy ? <span className="sync-msg">{st.msg || '맞추는 중…'}</span>
        : st?.error ? <span className="sync-err" title={st.error}>실패 — {st.error.slice(0, 40)}</span>
          : st?.at ? <span className="sync-msg">{time(st.at)} {st.msg}</span> : null}
      {cloud ? <span className="sync-msg" title="원격에만 있고 아직 받지 않은 문서 — 열면 받는다">☁ {cloud}</span> : null}
      <button onClick={stop(onSync)} disabled={st?.busy} title="지금 맞추기">⟳</button>
      <button onClick={stop(onSetup)} title="원격 설정">⚙</button>
      {/* 이 저장소 하나만 폰으로 — 폰의 원격 연결 · 가져오기에서 📷 로 읽는다 */}
      {!IS_MOBILE && onQr && <button onClick={stop(onQr)} title="이 저장소의 원격 설정을 QR 로 — 폰에서 읽으면 주소 · 사용자 · 비밀번호가 들어갑니다">QR</button>}
    </div>
  )
}
