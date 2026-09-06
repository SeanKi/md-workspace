import React, { useCallback, useEffect, useState } from 'react'
import { gitStatus, gitInit } from './git.js'

/** 저장소 머리의 git 줄. 저장소가 아니면 초기화 버튼을 보여준다. */
export default function GitLine({ repo, tick }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(() => { gitStatus(repo).then(setSt) }, [repo])

  // 초기화 결과는 잠깐만 보여준다. 사이드바에 계속 남으면 지저분하다.
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 5000)
    return () => clearTimeout(t)
  }, [msg])
  useEffect(() => { refresh() }, [refresh, tick])

  if (!st || !st.has_git) return null

  const init = async (e) => {
    e.stopPropagation()
    setBusy(true)
    try { setMsg(await gitInit(repo)) } catch (err) { setMsg(String(err)) }
    setBusy(false)
    refresh()
  }

  return (
    <div className="repo-git" title={repo.path}>
      {st.is_repo ? (
        <>
          <span className="git-on">⎇ {st.branch || '(커밋 없음)'}</span>
          {st.changes > 0 && <span className="git-dirty">변경 {st.changes}</span>}
          {!st.is_root && (
            <span className="git-msg" title={st.root}>상위 저장소: {st.root}</span>
          )}
        </>
      ) : (
        <>
          <span className="git-off">git 아님</span>
          <button onClick={init} disabled={busy}>{busy ? '…' : 'Git 초기화'}</button>
        </>
      )}
      {msg && <span className="git-msg">{msg}</span>}
    </div>
  )
}
