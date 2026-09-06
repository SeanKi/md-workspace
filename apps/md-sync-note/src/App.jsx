import React, { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { SplitEditor, isTauri, loadSettings, saveSettings, normalizeForEditor, describeFixes } from '@md/editor-core'
import RepoTree from './RepoTree.jsx'
import SearchPanel from './SearchPanel.jsx'
import SideSplit, { SIDE_DEFAULT } from './SideSplit.jsx'
import SettingsBar from './SettingsBar.jsx'
import usePendingCommits from './usePendingCommits.js'
import { revealText } from './revealText.js'
import { loadRepos, saveRepos, baseName, repoOf } from './repos.js'
import { gitCommit, commitMessage } from './git.js'

const SETTINGS_KEY = 'md-sync-note-settings'
const DEFAULTS = {
  imageDir: 'images', autoSaveSec: 60, autoCommit: true, wideLayout: false,
  sideWidth: SIDE_DEFAULT,
}
/** 자동 저장을 꺼 뒀어도 트리에서 한 파일 조작은 이 간격으로 커밋한다(초) */
const OPS_FALLBACK_SEC = 60

let seq = 0

export default function App() {
  const [repos, setRepos] = useState(loadRepos)
  const [settings, setSettings] = useState(() => loadSettings(SETTINGS_KEY, DEFAULTS))
  const [showSettings, setShowSettings] = useState(false)
  const [doc, setDoc] = useState(null)          // { path, content, dirty, savedAt }
  const [status, setStatus] = useState('')
  const [gitTick, setGitTick] = useState(0)     // 커밋 후 트리의 git 상태를 새로 읽게 한다

  const ctxRef = useRef({ path: null, imageDir: DEFAULTS.imageDir })
  ctxRef.current = { path: doc?.path ?? null, imageDir: settings.imageDir }

  const docRef = useRef(doc)
  docRef.current = doc

  // 자동 저장 타이머는 만들어진 시점의 클로저를 붙잡고 있으므로,
  // 커밋에 필요한 최신 설정·저장소 목록은 ref 로 본다.
  const cfgRef = useRef({ settings, repos })
  cfgRef.current = { settings, repos }

  // 트리에서 한 파일 조작을 모았다가 자동 저장 박자에 맞춰 커밋한다
  const { note: noteOp, flush: flushOps } = usePendingCommits({ cfgRef, setStatus, setGitTick })

  /* ---------- 저장소 ---------- */

  const addRepo = useCallback(async () => {
    if (!isTauri) {
      const demo = { id: `r${++seq}`, name: '데모 저장소', kind: 'local', path: '/demo' }
      setRepos((rs) => { const n = [...rs, demo]; saveRepos(n); return n })
      return
    }
    const picked = await openDialog({ directory: true, multiple: false })
    const path = typeof picked === 'string' ? picked : picked?.path
    if (!path) return
    setRepos((rs) => {
      if (rs.some((r) => r.path === path)) return rs
      const n = [...rs, { id: `r${++seq}-${Date.now()}`, name: baseName(path), kind: 'local', path }]
      saveRepos(n)
      return n
    })
  }, [])

  const removeRepo = useCallback((id) => {
    setRepos((rs) => { const n = rs.filter((r) => r.id !== id); saveRepos(n); return n })
  }, [])

  /* ---------- 문서 ---------- */

  const openDoc = useCallback(async (path, reveal) => {
    if (docRef.current?.dirty) await persist(docRef.current)
    try {
      const raw = isTauri ? await invoke('read_file', { path }) : `# ${baseName(path)}\n\n데모 문서입니다.`
      // MDXEditor 는 MDX 로 읽어서 태그가 아닌 `<` 를 만나면 파싱이 실패한다
      const { text: content, count, stat } = normalizeForEditor(raw)
      setDoc({ path, content, dirty: false })
      setStatus(count ? `${describeFixes(stat)}를 고쳐 열었습니다 (저장 시 반영)` : '')
      // 검색 결과로 열었으면 그 자리로 데려간다 (에디터가 그려질 때까지 기다린다)
      if (reveal) revealText(reveal)
    } catch (e) {
      setStatus(`열 수 없습니다: ${e}`)
    }
  }, [])

  async function persist(d) {
    if (!d?.path || !d.dirty) return
    if (!isTauri) { setStatus('저장됨(데모)'); return }
    try {
      await invoke('write_file', { path: d.path, contents: d.content })
      setDoc((cur) => (cur && cur.path === d.path ? { ...cur, dirty: false } : cur))
      setStatus(`저장됨 ${new Date().toLocaleTimeString()}`)
      await commit(d.path)
    } catch (e) {
      setStatus(`저장 실패: ${e}`)
    }
  }

  /** 저장이 실제로 일어났을 때만 커밋한다. 저장소가 git 이 아니면 조용히 넘어간다. */
  async function commit(path) {
    const { settings: cfg, repos: rs } = cfgRef.current
    if (!cfg.autoCommit) return
    const repo = repoOf(rs, path)
    if (!repo) return
    try {
      const r = await gitCommit(repo.path, commitMessage(path))
      if (r.committed) {
        setStatus(`저장됨 · ${r.detail}`)
        setGitTick((n) => n + 1)
      }
    } catch (e) {
      // 커밋이 실패해도 파일은 이미 저장됐다. 그 사실을 지우지 않는다.
      setStatus(`저장됨 · 커밋 실패: ${e}`)
    }
  }

  // initialNormalize 는 "파일을 연 직후 MDXEditor 가 스스로 다듬은 것"이라는 표시다.
  // 이걸 편집으로 치면 자동 저장이 손대지도 않은 파일을 다시 써 버린다.
  const onChange = useCallback((md, initialNormalize) => {
    setDoc((d) => (
      !d || md === d.content ? d : { ...d, content: md, dirty: initialNormalize ? d.dirty : true }
    ))
  }, [])

  /** 저장 단추와 Ctrl+S. 파일 조작을 먼저 그 내용대로 커밋하고 문서를 저장한다 */
  async function saveNow() {
    await flushOps()
    await persist(docRef.current)
  }

  /**
   * 트리에서 이름이 바뀌거나 옮겨지거나 지워졌을 때.
   * 열어 둔 문서가 그 대상이면 경로를 맞춰 주고, 저장소에는 커밋할 거리로 적어 둔다.
   * 폴더를 바꾼 경우도 있으므로 경로가 그 아래로 시작하는지까지 본다.
   */
  const onPathChanged = useCallback((from, to, kind) => {
    noteOp(kind, from, to)
    setDoc((d) => {
      if (!d) return d
      const same = d.path === from
      const inside = d.path.startsWith(from.replace(/[\/]+$/, '') + '/')
      if (!same && !inside) return d
      if (to === null) { setStatus('열려 있던 문서가 삭제됐습니다'); return null }
      const next = same ? to : to + d.path.slice(from.length)
      setStatus('경로가 바뀌었습니다')
      return { ...d, path: next }
    })
  }, [noteOp])

  /* ---------- 자동 저장 ---------- */

  useEffect(() => {
    const sec = Number(settings.autoSaveSec) || 0
    // 자동 저장을 꺼 뒀어도 트리에서 한 이름 바꾸기·옮기기는 남겨야 한다
    const every = sec > 0 ? sec : OPS_FALLBACK_SEC
    const t = setInterval(async () => {
      // 파일 조작을 먼저 커밋해야 "무엇이 어떻게 바뀌었는지" 가 저장 커밋에 섞이지 않는다
      await flushOps()
      if (sec > 0) await persist(docRef.current)
    }, every * 1000)
    return () => clearInterval(t)
  }, [settings.autoSaveSec])

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------- 설정 ---------- */

  const update = (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(SETTINGS_KEY, next)
  }

  /* ---------- 렌더 ---------- */

  return (
    <div className="shell">
      <aside className="sidebar" style={{ width: settings.sideWidth ?? SIDE_DEFAULT }}>
        <div className="side-head">
          <span>저장소</span>
          <span className="spacer" />
          <button onClick={addRepo} title="폴더 추가">+ 추가</button>
        </div>
        <SearchPanel repos={repos} activePath={doc?.path} onOpen={openDoc} />
        <div className="side-body">
          {repos.length === 0
            ? <div className="empty">아직 저장소가 없습니다.<br />“+ 추가”로 폴더를 등록하세요.</div>
            : repos.map((r) => (
                <RepoTree key={r.id} repo={r} activePath={doc?.path} gitTick={gitTick}
                          onOpen={openDoc} onRemove={removeRepo}
                          onPathChanged={onPathChanged} />
              ))}
        </div>
      </aside>

      <SideSplit onChange={(w) => update({ sideWidth: w })} />

      <main className="main">
        <div className="titlebar">
          <span className="name">{doc ? baseName(doc.path) : '문서를 선택하세요'}</span>
          {doc?.dirty && <span className="dot">●</span>}
          <span className="path">{doc?.path ?? ''}</span>
          <span className="spacer" />
          <span className="status">{status}</span>
          <button onClick={saveNow} title="Ctrl+S">저장</button>
          <button onClick={() => setShowSettings((v) => !v)} title="설정">⚙</button>
        </div>

        {showSettings && (
          <SettingsBar settings={settings} onChange={update} opsFallbackSec={OPS_FALLBACK_SEC} />
        )}

        {doc
          ? <SplitEditor key={doc.path} markdown={doc.content} onChange={onChange}
                         ctxRef={ctxRef} wide={settings.wideLayout} />
          : (
            <div className={'editor-wrap' + (settings.wideLayout ? ' wide' : '')}>
              <div className="placeholder">왼쪽 트리에서 문서를 선택하면 여기에 열립니다.</div>
            </div>
          )}
      </main>
    </div>
  )
}
