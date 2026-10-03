import React, { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@md/editor-core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  SplitEditor, isTauri, normalizeForEditor, describeFixes, bigDocNotice, initialViewMode,
  startDiag, useBusy, note, samePath, pushRecent, dropRecent,
} from '@md/editor-core'
import RepoTree from './RepoTree.jsx'
import SearchPanel from './SearchPanel.jsx'
import SideSplit, { SIDE_DEFAULT } from './SideSplit.jsx'
import SettingsBar from './SettingsBar.jsx'
import NoteTabs from './NoteTabs.jsx'
import usePendingCommits from './usePendingCommits.js'
import { revealText } from './revealText.js'
import { baseName, repoOf } from './repos.js'
import { loadConfig, saveConfig, onConfigError } from './config.js'
import { gitCommit, commitMessage } from './git.js'

const DEFAULTS = {
  imageDir: 'images', autoSaveSec: 60, autoCommit: true, wideLayout: false,
  sideWidth: SIDE_DEFAULT,
  // 큰 문서는 원본 모드로 연다 (위지윅은 한 글자에 0.6초가 든다 — `bigDoc.js`)
  bigDocSource: true,
  // MD Notepad 실행 파일. 비우면 Rust 가 알아서 찾는다 (`open_with.rs`)
  editorPath: '',
}
/** 자동 저장을 꺼 뒀어도 트리에서 한 파일 조작은 이 간격으로 커밋한다(초) */
const OPS_FALLBACK_SEC = 60
/** 탭은 이만큼까지. 넘으면 가장 오래 안 본 **고치지 않은** 탭이 닫힌다 */
const MAX_TABS = 30

let seq = 0
let tabSeq = 0

export default function App() {
  const [repos, setRepos] = useState([])
  const [settings, setSettings] = useState(DEFAULTS)
  const [recent, setRecent] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [status, setStatus] = useState('')
  const [gitTick, setGitTick] = useState(0)     // 커밋 후 트리의 git 상태를 새로 읽게 한다

  /*
   * 열어 둔 노트들. `{ id, path, content, dirty }`
   *
   * **같은 문서는 탭 하나뿐이다.** 트리에서 이미 열린 문서를 누르면 그 탭으로 가고,
   * 탭을 고르면 왼쪽 트리에서 그 줄이 켜진다 — 양쪽이 한 곳을 가리킨다.
   */
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)
  const active = tabs.find((t) => t.id === activeId) ?? null

  // 이미지·링크 핸들러가 항상 최신 문서 경로와 설정을 보도록 ref 로 전달.
  // 내용은 문서 여는 함수가 만들어진 뒤에 채운다 (아래)
  const ctxRef = useRef({ path: null, imageDir: DEFAULTS.imageDir })

  // 콜백 안에서 최신 탭 목록·활성 탭을 보기 위한 미러
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // 마지막으로 이 탭을 본 시각. 탭 객체에 넣으면 탭을 옮겨 다닐 때마다 목록 전체가
  // 다시 그려지므로 ref 에 따로 둔다 (탭이 넘칠 때 무엇을 닫을지 고르는 데 쓴다)
  const usedAt = useRef(new Map())
  useEffect(() => { if (activeId) usedAt.current.set(activeId, Date.now()) }, [activeId])

  /*
   * 편집 중인 내용은 **상태가 아니라 ref** 에 둔다 (탭마다 하나씩).
   * 글자 하나마다 setState 를 하면 앱 전체가 다시 그려진다 — 큰 문서에서 재어 보니
   * 그것만으로 한 글자에 0.35초가 더 들었다. 화면에 보이는 것은 파일 이름과 ● 뿐이다.
   */
  const liveRef = useRef(new Map())
  const liveOf = useCallback((t) => (t ? liveRef.current.get(t.id) ?? t.content : ''), [])

  // 자동 저장 타이머는 만들어진 시점의 클로저를 붙잡고 있으므로,
  // 커밋에 필요한 최신 설정·저장소 목록은 ref 로 본다.
  const cfgRef = useRef({ settings, repos })
  cfgRef.current = { settings, repos }
  const recentRef = useRef(recent)
  recentRef.current = recent

  // 트리에서 한 파일 조작을 모았다가 자동 저장 박자에 맞춰 커밋한다
  const { note: noteOp, flush: flushOps } = usePendingCommits({ cfgRef, setStatus, setGitTick })

  // 화면이 멎는 상황을 기록한다 (숨김 폴더 `.mdlog`)
  useEffect(() => startDiag('md-sync-note'), [])

  // 오래 걸리는 일이 있으면 무엇을 하는 중인지 말해 준다 (멎은 것으로 오해하지 않게)
  const busy = useBusy()

  // 창 제목(작업 표시줄) — 연 문서 · 앱 이름 · 버전.
  // `core:window:allow-set-title` 이 있어야 한다. 막히면 조용하므로 기록에 남긴다
  useEffect(() => {
    const full = active
      ? `${active.dirty ? '● ' : ''}${baseName(active.path)} — MDSyncNote v${__APP_VERSION__}`
      : `MDSyncNote v${__APP_VERSION__}`
    document.title = full
    if (isTauri) getCurrentWindow().setTitle(full).catch((e) => note(`창 제목 실패: ${e}`))
  }, [active?.path, active?.dirty])

  /* ---------- 환경 설정 파일 (실행 파일 옆 MDSyncNote.ini) ---------- */

  const [configPath, setConfigPath] = useState('')

  useEffect(() => {
    onConfigError((e) => setStatus(e))
    loadConfig(DEFAULTS).then(({ settings: s, repos: r, recent: rc, path, note: hint }) => {
      setSettings(s)
      setRepos(r)
      setRecent(rc)
      setConfigPath(path)
      seq = r.length                       // 새로 더하는 저장소 번호가 겹치지 않게
      if (hint) setStatus(hint)
    })
  }, [])

  /** 설정·저장소·최근 목록은 한 파일에 함께 담긴다. 쓰는 길은 하나뿐이어야 어긋나지 않는다 */
  const save3 = useCallback((s, r, rc) => {
    saveConfig(s ?? cfgRef.current.settings, r ?? cfgRef.current.repos, rc ?? recentRef.current)
  }, [])

  const update = useCallback((patch) => {
    const next = { ...cfgRef.current.settings, ...patch }
    setSettings(next)
    save3(next, null, null)
  }, [save3])

  /* ---------- 저장소 ---------- */

  const addRepo = useCallback(async () => {
    if (!isTauri) {
      const demo = { id: `r${++seq}`, name: '데모 저장소', kind: 'local', path: '/demo' }
      setRepos((rs) => { const n = [...rs, demo]; save3(null, n, null); return n })
      return
    }
    const picked = await openDialog({ directory: true, multiple: false })
    const path = typeof picked === 'string' ? picked : picked?.path
    if (!path) return
    setRepos((rs) => {
      if (rs.some((r) => r.path === path)) return rs
      const n = [...rs, { id: `r${++seq}-${Date.now()}`, name: baseName(path), kind: 'local', path }]
      save3(null, n, null)
      return n
    })
  }, [save3])

  const removeRepo = useCallback((id) => {
    setRepos((rs) => { const n = rs.filter((r) => r.id !== id); save3(null, n, null); return n })
  }, [save3])

  /* ---------- 최근 문서 ---------- */

  // 연 문서는 맨 앞으로(중복은 하나만), 열리지 않은 것은 목록에서 뺀다
  const noteRecent = useCallback((path, ok) => {
    setRecent((list) => {
      const next = ok ? pushRecent(list, path) : dropRecent(list, path)
      save3(null, null, next)
      return next
    })
  }, [save3])

  /* ---------- 문서 ---------- */

  /*
   * 위지윅으로 읽지 못하는 문서(예: MDX 가 자기 문법으로 보는 `{ }`)는 **원본 모드로
   * 다시 열고 무엇이 문제인지 말해 준다.** 빈 화면을 보여줄 이유가 없다.
   * MDXEditor 는 읽기에 실패해도 원본 글자를 들고 있고 스스로 파일을 다시 쓰지 않는다.
   */
  const [failed, setFailed] = useState({})
  const onEditorError = useCallback(({ error }) => {
    const t = activeRef.current
    if (!t) return
    setFailed((m) => (m[t.id] ? m : { ...m, [t.id]: true }))
    setStatus(`위지윅으로 열 수 없어 원본 모드로 열었습니다 — ${String(error).slice(0, 120)}`)
  }, [])

  /**
   * 트리·검색·문서 안의 링크가 모두 여기로 온다.
   *
   * **이미 열려 있으면 그 탭으로 간다.** 같은 문서를 두 번 열면 한쪽에서 고친 것이
   * 다른 쪽 저장에 덮이므로 애초에 둘이 되게 두지 않는다.
   */
  const openDoc = useCallback(async (path, reveal) => {
    const found = tabsRef.current.find((t) => samePath(t.path, path))
    if (found) {
      setActiveId(found.id)
      noteRecent(path, true)
      if (reveal) revealText(reveal)
      return
    }
    try {
      const raw = isTauri ? await invoke('read_file', { path }) : `# ${baseName(path)}\n\n데모 문서입니다.`
      // MDXEditor 는 MDX 로 읽어서 태그가 아닌 `<` 를 만나면 파싱이 실패한다
      const { text: content, count, stat } = normalizeForEditor(raw)

      /*
       * 탭은 MAX_TABS 개까지. 넘으면 **가장 오래 안 본** 탭을 닫아 자리를 만든다.
       * **고친 탭은 절대 닫지 않는다** — 저장하지 않은 것을 말없이 버리면 안 된다.
       */
      const ts0 = tabsRef.current
      let drop = null
      if (ts0.length >= MAX_TABS) {
        drop = ts0
          .filter((x) => !x.dirty)
          .sort((a, b) => (usedAt.current.get(a.id) ?? 0) - (usedAt.current.get(b.id) ?? 0))[0] ?? null
        if (!drop) {
          setStatus(`탭이 ${MAX_TABS}개이고 모두 고친 상태입니다 — 몇 개 저장하고 닫아 주세요`)
          return
        }
        liveRef.current.delete(drop.id)
        usedAt.current.delete(drop.id)
      }

      const t = { id: `n${++tabSeq}`, path, content, dirty: false }
      liveRef.current.set(t.id, content)
      setTabs((ts) => [...(drop ? ts.filter((x) => x.id !== drop.id) : ts), t])
      setActiveId(t.id)
      noteRecent(path, true)
      setStatus(drop
        ? `탭이 ${MAX_TABS}개를 넘어 "${baseName(drop.path)}" 을(를) 닫았습니다`
        : (count ? `${describeFixes(stat)}를 고쳐 열었습니다 (저장 시 반영)` : bigDocNotice(content)))
      // 검색 결과로 열었으면 그 자리로 데려간다 (에디터가 그려질 때까지 기다린다)
      if (reveal) revealText(reveal)
    } catch (e) {
      noteRecent(path, false)
      setStatus(`열 수 없습니다: ${e}`)
    }
  }, [noteRecent])

  // 문서 안의 `[글](다른글.md)` 링크를 Ctrl+누르면 이 함수로 온다 (`linkNav.js`)
  ctxRef.current = { path: active?.path ?? null, imageDir: settings.imageDir, openFile: openDoc }

  /** 한 탭을 파일로 쓴다. 고친 것이 없으면 아무 일도 하지 않는다 */
  const persist = useCallback(async (t) => {
    if (!t?.path || !t.dirty) return
    if (!isTauri) { setStatus('저장됨(데모)'); return }
    const contents = liveOf(t)
    try {
      await invoke('write_file', { path: t.path, contents })
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: false } : x)))
      setStatus(`저장됨 ${new Date().toLocaleTimeString()}`)
      await commit(t.path)
    } catch (e) {
      setStatus(`저장 실패: ${e}`)
    }
  }, [liveOf])

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

  /** 고친 탭을 모두 쓴다. 자동 저장이 부른다 */
  const persistAll = useCallback(async () => {
    for (const t of tabsRef.current.filter((x) => x.dirty)) await persist(t)
  }, [persist])

  // initialNormalize 는 "파일을 연 직후 MDXEditor 가 스스로 다듬은 것"이라는 표시다.
  // 이걸 편집으로 치면 자동 저장이 손대지도 않은 파일을 다시 써 버린다.
  const onChange = useCallback((md, initialNormalize) => {
    const t = activeRef.current
    if (!t || md === liveOf(t)) return
    liveRef.current.set(t.id, md)             // 내용은 여기까지. 다시 그리지 않는다
    // ● 는 한 번만 켜면 된다. 매번 켜면 그때마다 앱이 다시 그려진다
    if (!initialNormalize && !t.dirty) {
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: true } : x)))
    }
  }, [liveOf])

  /* ---------- 탭 ---------- */

  /**
   * 탭을 닫는다. **고친 것이 있으면 먼저 저장한다** — 묻지 않는다.
   * 이 앱은 자동 저장이 기본이고, 진실의 원천은 언제나 실제 `.md` 파일이다.
   */
  const closeTab = useCallback(async (id) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    if (t.dirty) await persist(t)
    liveRef.current.delete(id)
    setFailed((m) => { if (!m[id]) return m; const n = { ...m }; delete n[id]; return n })
    setTabs((ts) => {
      const rest = ts.filter((x) => x.id !== id)
      if (id === activeIdRef.current) {
        const i = ts.findIndex((x) => x.id === id)
        setActiveId((rest[i] ?? rest[i - 1] ?? rest[0])?.id ?? null)
      }
      return rest
    })
  }, [persist])

  /** 저장 단추와 Ctrl+S. 파일 조작을 먼저 그 내용대로 커밋하고 문서를 저장한다 */
  async function saveNow() {
    await flushOps()
    await persist(activeRef.current)
  }

  /**
   * 트리에서 이름이 바뀌거나 옮겨지거나 지워졌을 때.
   * 열어 둔 탭이 그 대상이면 경로를 맞춰 주고, 저장소에는 커밋할 거리로 적어 둔다.
   * 폴더를 바꾼 경우도 있으므로 경로가 그 아래로 시작하는지까지 본다.
   */
  const onPathChanged = useCallback((from, to, kind) => {
    noteOp(kind, from, to)
    setTabs((ts) => {
      let touched = false
      const next = []
      for (const t of ts) {
        const same = samePath(t.path, from)
        const inside = t.path.replace(/\\/g, '/').toLowerCase()
          .startsWith(from.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') + '/')
        if (!same && !inside) { next.push(t); continue }
        touched = true
        if (to === null) {                    // 지워진 문서의 탭은 닫는다
          liveRef.current.delete(t.id)
          continue
        }
        next.push({ ...t, path: same ? to : to + t.path.slice(from.length) })
      }
      if (!touched) return ts
      setStatus(to === null ? '열려 있던 문서가 삭제됐습니다' : '경로가 바뀌었습니다')
      if (!next.some((t) => t.id === activeIdRef.current)) setActiveId(next[next.length - 1]?.id ?? null)
      return next
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
      if (sec > 0) await persistAll()
    }, every * 1000)
    return () => clearInterval(t)
  }, [settings.autoSaveSec, flushOps, persistAll])

  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); saveNow() }
      else if (k === 'w') { e.preventDefault(); if (activeIdRef.current) closeTab(activeIdRef.current) }
      else if (e.key === 'Tab') {
        e.preventDefault()
        const ts = tabsRef.current
        if (ts.length < 2) return
        const i = ts.findIndex((x) => x.id === activeIdRef.current)
        setActiveId(ts[(i + (e.shiftKey ? -1 : 1) + ts.length) % ts.length].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeTab])

  /* ---------- 렌더 ---------- */

  const activePath = active?.path ?? null

  return (
    <div className="shell">
      <aside className="sidebar" style={{ width: settings.sideWidth ?? SIDE_DEFAULT }}>
        <div className="side-head">
          <span>저장소</span>
          <span className="spacer" />
          <button onClick={addRepo} title="폴더 추가">+ 추가</button>
        </div>
        <SearchPanel repos={repos} activePath={activePath} onOpen={openDoc} />
        <div className="side-body">
          {repos.length === 0
            ? <div className="empty">아직 저장소가 없습니다.<br />“+ 추가”로 폴더를 등록하세요.</div>
            : repos.map((r) => (
                <RepoTree key={r.id} repo={r} activePath={activePath} gitTick={gitTick}
                          onOpen={openDoc} onRemove={removeRepo}
                          onPathChanged={onPathChanged}
                          editorPath={settings.editorPath}
                          setEditorPath={(p) => update({ editorPath: p })} />
              ))}
        </div>
      </aside>

      <SideSplit onChange={(w) => update({ sideWidth: w })} />

      <main className="main">
        <NoteTabs tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab}
                  recent={recent} onPickRecent={openDoc}
                  onClearRecent={() => { setRecent([]); save3(null, null, []) }} />

        <div className="titlebar">
          <span className="path">{activePath ?? ''}</span>
          <span className="spacer" />
          <span className="status">{busy || status}</span>
          <button onClick={saveNow} title="Ctrl+S">저장</button>
          <button onClick={() => setShowSettings((v) => !v)} title="설정">⚙</button>
        </div>

        {showSettings && (
          <SettingsBar settings={settings} onChange={update} opsFallbackSec={OPS_FALLBACK_SEC}
                       configPath={configPath} />
        )}

        {active
          ? <SplitEditor key={active.id + (failed[active.id] ? '·source' : '')}
                         // 원본 모드로 떨어질 때 다시 마운트된다. 그때 넘길 것은
                         // 지금 편집 중인 글자다 — 아니면 고치던 것이 사라진다
                         markdown={liveOf(active)}
                         onChange={onChange} onError={onEditorError}
                         ctxRef={ctxRef} wide={settings.wideLayout}
                         viewMode={failed[active.id]
                           ? 'source'
                           : initialViewMode(active.content, settings.bigDocSource)} />
          : (
            <div className={'editor-wrap' + (settings.wideLayout ? ' wide' : '')}>
              <div className="placeholder">왼쪽 트리에서 문서를 선택하면 여기에 열립니다.</div>
            </div>
          )}
      </main>
    </div>
  )
}
