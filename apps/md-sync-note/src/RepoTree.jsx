import React, { useCallback, useEffect, useState } from 'react'
import { listDir } from './repos.js'
import { gitStatus, gitInit } from './git.js'

function Node({ repo, entry, depth, activePath, onOpen }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState(null)
  const [error, setError] = useState(null)

  const toggle = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (next && kids === null) {
      try { setKids(await listDir(repo, entry.path)) }
      catch (e) { setError(String(e)); setKids([]) }
    }
  }, [open, kids, repo, entry.path])

  const pad = { paddingLeft: 8 + depth * 14 }

  if (!entry.is_dir) {
    return (
      <div
        className={'node file' + (activePath === entry.path ? ' on' : '')}
        style={pad}
        onClick={() => onOpen(entry.path)}
        title={entry.path}
      >
        <span className="ico">📄</span>{entry.name}
      </div>
    )
  }

  return (
    <>
      <div className="node dir" style={pad} onClick={toggle} title={entry.path}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="ico">{open ? '📂' : '📁'}</span>{entry.name}
      </div>
      {open && (
        kids === null
          ? <div className="node muted" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>읽는 중…</div>
          : error
            ? <div className="node err" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>{error}</div>
            : kids.length === 0
              ? <div className="node muted" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>(비어 있음)</div>
              : kids.map((k) => (
                  <Node key={k.path} repo={repo} entry={k} depth={depth + 1}
                        activePath={activePath} onOpen={onOpen} />
                ))
      )}
    </>
  )
}

/** 저장소 머리의 git 줄. 저장소가 아니면 초기화 버튼을 보여준다. */
function GitLine({ repo, tick }) {
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

export default function RepoTree({ repo, activePath, onOpen, onRemove, gitTick }) {
  const [open, setOpen] = useState(true)
  const [roots, setRoots] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || roots !== null) return
    listDir(repo, repo.path)
      .then(setRoots)
      .catch((e) => { setError(String(e)); setRoots([]) })
  }, [open, roots, repo])

  return (
    <div className="repo">
      <div className="repo-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="repo-name">{repo.name}</span>
        <span className="spacer" />
        <span className="repo-x" title="저장소 제거"
              onClick={(e) => { e.stopPropagation(); onRemove(repo.id) }}>×</span>
      </div>
      <div className="repo-path" title={repo.path}>{repo.path}</div>
      <GitLine repo={repo} tick={gitTick} />
      {open && (
        error ? <div className="node err">{error}</div>
        : roots === null ? <div className="node muted">읽는 중…</div>
        : roots.map((e) => (
            <Node key={e.path} repo={repo} entry={e} depth={0}
                  activePath={activePath} onOpen={onOpen} />
          ))
      )}
    </div>
  )
}
