import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SplitEditor, IMAGE_DIR } from '@md/editor-tiptap'
import { invoke, isTauri, startDiag, useBusy, note, samePath, pushRecent, dropRecent, BIG_DOC_CHARS } from './core.js'
import RepoTree from './RepoTree.jsx'
import SearchPanel, { SEARCH_HEIGHT } from './SearchPanel.jsx'
import SideSplit, { SIDE_DEFAULT } from './SideSplit.jsx'
import SettingsBar from './SettingsBar.jsx'
import NoteTabs from './NoteTabs.jsx'
import usePendingCommits from './usePendingCommits.js'
import { baseName, repoOf } from './repos.js'
import { loadConfig, saveConfig, onConfigError } from './config.js'
import { gitCommit, commitMessage } from './git.js'
import { SAMPLE } from './sample.js'
import useExternalChanges from './useExternalChanges.js'
import useNotepad, { pickOpenPaths, pickSavePath } from './useNotepad.js'
import ReloadDialog from './ReloadDialog.jsx'

/*
 * MD Tiptap — MDSyncNote 의 껍데기(저장소 트리 · 탭 · 검색 · git · 자동 저장)에
 * Tiptap 편집기를 얹은 것. 구조와 규칙은 md-sync-note/App.jsx 와 같고, 다른 점은
 * 편집 내용이 흐르는 길 하나다 (아래 "편집 중인 내용").
 */

const DEFAULTS = {
  imageDir: IMAGE_DIR, autoSaveSec: 60, autoCommit: true, wideLayout: false,
  sideWidth: SIDE_DEFAULT,
  searchHeight: SEARCH_HEIGHT,
  // Tiptap 은 글자마다 문서 전체를 다시 쓰지 않아 큰 문서도 위지윅으로 연다. 원하면 켠다
  bigDocSource: false,
  editorPath: '',
}
const OPS_FALLBACK_SEC = 60
const MAX_TABS = 30

let seq = 0
const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent)
let tabSeq = 0

export default function App() {
  const [repos, setRepos] = useState([])
  const [settings, setSettings] = useState(DEFAULTS)
  const [recent, setRecent] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [status, setStatus] = useState('')
  const [gitTick, setGitTick] = useState(0)
  // 좁은 화면(폰·세로 태블릿)에서는 트리가 서랍이다. 넓은 화면에서는 이 값을 보지 않는다
  const [sideOpen, setSideOpen] = useState(false)

  /** 열어 둔 노트들 `{ id, path, content, dirty }`. 같은 문서는 탭 하나뿐이다 */
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)
  const active = tabs.find((t) => t.id === activeId) ?? null

  const ctxRef = useRef({ path: null, imageDir: DEFAULTS.imageDir })
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  const usedAt = useRef(new Map())
  useEffect(() => { if (activeId) usedAt.current.set(activeId, Date.now()) }, [activeId])

  /*
   * 편집 중인 내용.
   *
   * MDXEditor 때는 글자마다 onChange 로 마크다운을 받아 ref 에 담았다. Tiptap 은 글자마다
   * 마크다운을 만들지 않는다(그게 빨라진 이유다). 그래서
   *   - 지금 보는 탭: 필요할 때 편집기에게 묻는다 (`editorApi.getMarkdown()`)
   *   - 다른 탭: 그 탭을 떠날 때 편집기가 넘겨준 마지막 내용 (`liveRef`)
   */
  const editorApi = useRef(null)
  const liveRef = useRef(new Map())
  const liveOf = useCallback((t) => {
    if (!t) return ''
    if (t.id === activeIdRef.current && editorApi.current) return editorApi.current.getMarkdown()
    return liveRef.current.get(t.id) ?? t.content
  }, [])

  const cfgRef = useRef({ settings, repos })
  cfgRef.current = { settings, repos }
  const recentRef = useRef(recent)
  recentRef.current = recent

  const { note: noteOp, flush: flushOps } = usePendingCommits({ cfgRef, setStatus, setGitTick })

  useEffect(() => startDiag('md-tiptap'), [])
  // 개발 중에는 브라우저 콘솔·자동 시험에서 편집기를 만질 수 있게 내놓는다
  if (import.meta.env.DEV) window.__tt = editorApi

  const busy = useBusy()

  useEffect(() => {
    const full = active
      ? `${active.dirty ? '● ' : ''}${baseName(active.path) || "새 문서"} — MD Tiptap v${__APP_VERSION__}`
      : `MD Tiptap v${__APP_VERSION__}`
    document.title = full
    if (!isTauri) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(full))
      .catch((e) => note(`창 제목 실패: ${e}`))
  }, [active?.path, active?.dirty])

  /* ---------- 환경 설정 파일 ---------- */

  const [configPath, setConfigPath] = useState('')
  const [configReady, setConfigReady] = useState(false)
  useEffect(() => {
    onConfigError((e) => setStatus(e))
    loadConfig(DEFAULTS).then(({ settings: s, repos: r, recent: rc, path, note: hint }) => {
      setSettings(s)
      setRepos(r)
      setRecent(rc)
      setConfigPath(path)
      seq = r.length
      if (hint) setStatus(hint)
      setConfigReady(true)
    })
  }, [])

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
    let path
    if (IS_MOBILE) {
      // 폰은 앱 안에 저장소를 만든다 (lib.rs app_repo_dir). 기기 간 공유는 나중에 동기화가 맡는다
      const name = window.prompt('새 저장소 이름', '노트')
      if (!name) return
      path = await invoke('app_repo_dir', { name }).catch((e) => { setStatus(`저장소를 만들 수 없습니다: ${e}`); return null })
    } else {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false })
      path = typeof picked === 'string' ? picked : picked?.path
    }
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

  const noteRecent = useCallback((path, ok) => {
    setRecent((list) => {
      const next = ok ? pushRecent(list, path) : dropRecent(list, path)
      save3(null, null, next)
      return next
    })
  }, [save3])

  /* ---------- 문서 ---------- */

  // 편집기가 스키마에 맞지 않는 내용을 만나면 그 탭은 원본 모드로 연다
  const [failed, setFailed] = useState({})
  const onEditorError = useCallback(({ error }) => {
    const t = activeRef.current
    if (!t) return
    setFailed((m) => (m[t.id] ? m : { ...m, [t.id]: true }))
    setStatus(`위지윅으로 열 수 없어 원본 모드로 열었습니다 — ${String(error).slice(0, 120)}`)
  }, [])

  /** 트리·검색·문서 안의 링크가 모두 여기로 온다. 이미 열려 있으면 그 탭으로 간다 */
  /*
   * 링크·검색 결과로 문서를 열면 **그 자리까지** 데려간다. 편집기가 그 탭으로 바뀐 뒤에야
   * 찾을 수 있으므로 여기서는 요청만 남기고, 편집기(SplitEditor 의 reveal)가 그린 뒤 처리한다.
   * reveal = { heading } (링크의 #제목) | { texts } (검색 결과 줄) | [줄, 낱말] (검색 패널)
   */
  const [revealReq, setRevealReq] = useState(null)
  const askReveal = (id, reveal) => {
    if (!reveal) return
    const target = Array.isArray(reveal) ? { texts: reveal } : reveal
    setRevealReq((r) => ({ id, target, n: (r?.n ?? 0) + 1 }))
  }

  const openDoc = useCallback(async (path, reveal) => {
    const found = tabsRef.current.find((t) => samePath(t.path, path))
    if (found) {
      setActiveId(found.id)
      noteRecent(path, true)
      askReveal(found.id, reveal)
      return
    }
    try {
      // MDX 가 아니라 GFM 으로 읽으므로 열기 전에 다듬을 것이 없다
      const content = isTauri ? await invoke('read_file', { path })
        : (path.endsWith('diary.md') ? SAMPLE : `# ${baseName(path)}\n\n데모 문서입니다.\n`)

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
      setTabs((ts) => [...(drop ? ts.filter((x) => x.id !== drop.id) : ts), t])
      setActiveId(t.id)
      noteRecent(path, true)
      setStatus(drop ? `탭이 ${MAX_TABS}개를 넘어 "${baseName(drop.path)}" 을(를) 닫았습니다` : '')
      askReveal(t.id, reveal)
    } catch (e) {
      noteRecent(path, false)
      setStatus(`열 수 없습니다: ${e}`)
    }
  }, [noteRecent])


  /** 저장이 실제로 일어났을 때만 커밋한다. 저장소가 git 이 아니면 조용히 넘어간다 */
  const commit = useCallback(async (path) => {
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
      setStatus(`저장됨 · 커밋 실패: ${e}`)
    }
  }, [])

  /** 한 탭을 파일로 쓴다. 고친 것이 없으면 아무 일도 하지 않는다 */
  const persist = useCallback(async (t) => {
    if (!t?.path || !t.dirty) return
    if (!isTauri) { setStatus('저장됨(데모)'); setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: false } : x))); return }
    try {
      await invoke('write_file', { path: t.path, contents: liveOf(t) })
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: false } : x)))
      setStatus(`저장됨 ${new Date().toLocaleTimeString()}`)
      await commit(t.path)
    } catch (e) {
      setStatus(`저장 실패: ${e}`)
    }
  }, [liveOf, commit])

  const persistAll = useCallback(async () => {
    for (const t of tabsRef.current.filter((x) => x.dirty)) await persist(t)
  }, [persist])

  // ● 는 한 번만 켠다. 매번 켜면 그때마다 앱이 다시 그려진다
  const onDirty = useCallback(() => {
    const t = activeRef.current
    if (t && !t.dirty) setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: true } : x)))
  }, [])

  /* ---------- 탭 ---------- */

  /** 탭을 닫는다. 고친 것이 있으면 먼저 저장한다 — 묻지 않는다 (자동 저장이 기본인 앱) */
  const closeTab = useCallback(async (id) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    // 새 문서는 저장할 자리가 없다 — 이것만은 묻는다
    if (!t.path && t.dirty && !window.confirm('저장하지 않은 새 문서입니다. 버리고 닫을까요?')) return
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

  /** 다른 이름으로 저장. 새 문서(경로 없음)의 첫 저장도 여기로 온다 */
  const saveAs = useCallback(async (t = activeRef.current) => {
    if (!t || !isTauri) return null
    const p = await pickSavePath(t.path)
    if (!p) return null
    try {
      await invoke('write_file', { path: p, contents: liveOf(t) })
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, path: p, dirty: false } : x)))
      noteRecent(p, true)
      setStatus(`저장됨 — ${baseName(p)}`)
      await commit(p)
      return p
    } catch (e) {
      setStatus(`저장 실패: ${e}`)
      return null
    }
  }, [liveOf, noteRecent, commit])

  async function saveNow() {
    await flushOps()
    const t = activeRef.current
    if (t && !t.path) { await saveAs(t); return }
    await persist(t)
  }

  /* ---------- MD Notepad 처럼: 새 문서 · 아무 파일 열기 ---------- */

  const newDoc = useCallback(() => {
    const t = { id: `n${++tabSeq}`, path: null, content: '', dirty: false }
    setTabs((ts) => [...ts, t])
    setActiveId(t.id)
  }, [])

  const openAny = useCallback(async () => {
    if (!isTauri) return
    for (const p of await pickOpenPaths()) await openDoc(p)
  }, [openDoc])

  // 명령줄 · 이미 떠 있는 창으로 넘어온 파일 · 끌어다 놓은 파일
  useNotepad(openDoc, configReady)

  // 밖에서 바뀐 파일
  const { conflicts, resolveConflict } = useExternalChanges({
    tabs, tabsRef, setTabs, setActiveId, activeIdRef, say: setStatus, liveOf, liveRef,
  })

  ctxRef.current = {
    path: active?.path ?? null, imageDir: settings.imageDir, openFile: openDoc,
    // 이미지는 문서 폴더 기준이라 새 문서는 저장부터 받는다
    ensureSaved: () => saveAs(activeRef.current),
    // [[내부 링크]] — Obsidian 처럼 이름으로 찾는다. 지금 문서의 폴더 → 저장소 전체 (lib.rs find_note)
    openWiki: async (name, heading) => {
      if (!isTauri) { openDoc(`/demo/${name}.md`); return }
      const cur = activeRef.current?.path
      const near = cur ? cur.replace(/[\\/][^\\/]*$/, '') : null
      /*
       * 찾는 차례 — Obsidian 이 **그 문서가 든 볼트 전체**에서 이름으로 찾는 것과 맞춘다.
       *   1. 이 문서가 든 저장소 (= 볼트)
       *   2. 이 문서의 폴더와 그 아래 전부 — 저장소 밖에서 Ctrl+O 로 연 문서는 이것이 볼트다.
       *      (예전에는 이 폴더 "한 층" 만 봐서 `deep/…/노트B.md` 를 못 찾았다)
       *   3. 나머지 저장소
       */
      const repos = cfgRef.current.repos.map((r) => r.path)
      const home = cur ? repoOf(cfgRef.current.repos, cur)?.path : null
      const roots = [home, near, ...repos].filter((p, i, a) => p && a.findIndex((q) => q && samePath(q, p)) === i)
      const found = await invoke('find_note', { roots, near, name })
        .catch((e) => { note(`내부 링크 찾기 실패: ${e}`); return null })
      if (!found) { setStatus(`"${name}" 을(를) 이 문서의 폴더와 저장소에서 찾지 못했습니다`); return }
      if (/\.(md|markdown|mdx|txt)$/i.test(found)) openDoc(found, heading ? { heading } : undefined)
      else invoke('open_external', { target: found }).catch((e) => setStatus(String(e)))
    },
  }

  /** 트리에서 이름이 바뀌거나 옮겨지거나 지워졌을 때 — 열린 탭의 경로를 맞춘다 */
  const onPathChanged = useCallback((from, to, kind) => {
    noteOp(kind, from, to)
    setTabs((ts) => {
      let touched = false
      const next = []
      for (const t of ts) {
        if (!t.path) { next.push(t); continue }
        const same = samePath(t.path, from)
        const inside = t.path.replace(/\\/g, '/').toLowerCase()
          .startsWith(from.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') + '/')
        if (!same && !inside) { next.push(t); continue }
        touched = true
        if (to === null) { liveRef.current.delete(t.id); continue }
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
    const every = sec > 0 ? sec : OPS_FALLBACK_SEC
    const t = setInterval(async () => {
      await flushOps()
      if (sec > 0) await persistAll()
    }, every * 1000)
    return () => clearInterval(t)
  }, [settings.autoSaveSec, flushOps, persistAll])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else saveNow() }
      else if (k === 'o') { e.preventDefault(); openAny() }
      else if (k === 'n') { e.preventDefault(); newDoc() }
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
  }, [closeTab, saveAs, openAny, newDoc])

  const check = () => {
    const r = editorApi.current?.getStats?.()
    if (!r) { setStatus('위지윅 화면에서 검사합니다'); return }
    setStatus(`블록 ${r.total}개 — 원문 그대로 ${r.total - r.rewritten} · 새로 씀 ${r.rewritten} · 원문 조각 ${r.raw}` +
      ` · 열 때와 바이트 동일: ${r.same ? '예' : '아니오'} · ${r.ms.toFixed(1)}ms`)
  }

  /* ---------- 렌더 ---------- */

  const activePath = active?.path ?? null
  // 서랍에서 문서를 고르면 서랍은 닫는다 — 고른 문서를 보려고 연 것이니까
  const openFromSide = (path, reveal) => { setSideOpen(false); openDoc(path, reveal) }
  const startMode = (t) => (failed[t.id] || (settings.bigDocSource && (t.content?.length ?? 0) >= BIG_DOC_CHARS)
    ? 'source' : 'rich-text')

  return (
    <div className={`shell${sideOpen ? ' side-open' : ''}`}>
      <div className="side-scrim" onClick={() => setSideOpen(false)} />
      <aside className="sidebar" style={{ width: settings.sideWidth ?? SIDE_DEFAULT }}>
        <div className="side-head">
          <span>저장소</span>
          <span className="spacer" />
          <button onClick={addRepo} title="폴더 추가">+ 추가</button>
        </div>
        <SearchPanel repos={repos} activePath={activePath} onOpen={openFromSide}
                     height={Number(settings.searchHeight) || SEARCH_HEIGHT}
                     onHeight={(h) => update({ searchHeight: h })} />
        <div className="side-body">
          {repos.length === 0
            ? <div className="empty">아직 저장소가 없습니다.<br />“+ 추가”로 폴더를 등록하세요.</div>
            : repos.map((r) => (
                <RepoTree key={r.id} repo={r} activePath={activePath} gitTick={gitTick}
                          onOpen={openFromSide} onRemove={removeRepo}
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
          <button className="side-toggle" onClick={() => setSideOpen((v) => !v)} title="저장소">☰</button>
          {/* 경로는 골라서 복사할 수 있다. 두 번 누르면 통째로 골라진다 */}
          <span className="path selectable" title={activePath ? `${activePath}\n두 번 눌러 고르고 Ctrl+C 로 복사` : ''}
                onDoubleClick={(e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r) }}>
            {activePath ?? ''}
          </span>
          <span className="spacer" />
          <span className="status">{busy || status}</span>
          <button className="check-btn" onClick={check} title="몇 블록이 원문 그대로 저장되는지">검사</button>
          {/* 본문 폭 — 인쇄물처럼 가운데 고정 폭 ↔ 창 전체 폭. 설정에 남는다 */}
          <button className={`wide-btn${settings.wideLayout ? ' on' : ''}`} title="본문 폭 바꾸기"
                  onClick={() => update({ wideLayout: !settings.wideLayout })}>
            {settings.wideLayout ? '전체 폭' : '고정 폭'}
          </button>
          <button className="desk-only" onClick={newDoc} title="새 문서 (Ctrl+N)">새로</button>
          <button className="desk-only" onClick={openAny} title="아무 파일이나 열기 (Ctrl+O)">열기</button>
          <button onClick={saveNow} title="Ctrl+S · 다른 이름은 Ctrl+Shift+S">저장</button>
          <button onClick={() => setShowSettings((v) => !v)} title="설정">⚙</button>
        </div>

        {showSettings && (
          <SettingsBar settings={settings} onChange={update} opsFallbackSec={OPS_FALLBACK_SEC}
                       docPath={activePath}
                       configPath={configPath} />
        )}

        {active
          ? <SplitEditor key={active.id + (failed[active.id] ? '·source' : '')}
                         // 편집기에게 묻지 않고 **받아 둔** 내용으로 연다 (렌더마다 직렬화하지 않게)
                         markdown={liveRef.current.get(active.id) ?? active.content}
                         apiRef={editorApi}
                         onDirty={onDirty}
                         // 탭을 떠날 때 마지막 내용을 받아 둔다. 이 탭 id 를 붙잡아 둔다
                         onLeave={((id) => (md) => { liveRef.current.set(id, md) })(active.id)}
                         onError={onEditorError}
                         ctxRef={ctxRef} wide={settings.wideLayout}
                         viewMode={startMode(active)}
                         reveal={revealReq?.id === active.id ? revealReq : null} />
          : (
            <div className={'editor-wrap' + (settings.wideLayout ? ' wide' : '')}>
              <div className="placeholder">왼쪽 트리에서 문서를 선택하면 여기에 열립니다.</div>
            </div>
          )}
      </main>

      {conflicts[0] && (
        <ReloadDialog path={conflicts[0].path} mine={conflicts[0].mine} theirs={conflicts[0].text}
                      onReload={() => resolveConflict(conflicts[0].path, 'reload')}
                      onOverwrite={() => resolveConflict(conflicts[0].path, 'overwrite')} />
      )}
    </div>
  )
}
