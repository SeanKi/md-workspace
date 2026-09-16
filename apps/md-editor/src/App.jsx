import React, { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@md/editor-core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm } from '@tauri-apps/plugin-dialog'
import { SplitEditor, isTauri, loadSettings, saveSettings, startDiag, useBusy, note, initialViewMode } from '@md/editor-core'
import useFileDrop from './useFileDrop.js'
import TabBar from './TabBar.jsx'
import SettingsBar from './SettingsBar.jsx'
import useShortcuts from './useShortcuts.js'
import useFiles from './useFiles.js'
import useExternalChanges from './useExternalChanges.js'
import ReloadDialog from './ReloadDialog.jsx'
import { OPENABLE, baseName, docTitle } from './paths.js'
import { pushRecent, dropRecent } from './recent.js'

const SETTINGS_KEY = 'md-editor-settings'
/** 큰 문서는 원본 모드로 연다 (위지윅은 한 글자에 0.6초가 든다 — `bigDoc.js`) */
const DEFAULTS = { bigDocSource: true }
/** 타이핑이 멎고 이만큼 지나면 제목을 다시 센다 */
const TITLE_MS = 500

let seq = 0
const newTab = (path = null, content = '') => ({
  id: `t${++seq}`, path, content, dirty: false,
})

export default function App() {
  const [tabs, setTabs] = useState(() => [newTab()])
  const [activeId, setActiveId] = useState('t1')
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...loadSettings(SETTINGS_KEY) }))
  const [showSettings, setShowSettings] = useState(false)
  const [notice, setNotice] = useState('')
  const topRef = useRef(null)

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  /*
   * 편집 중인 내용은 **상태가 아니라 ref** 에 둔다.
   *
   * 글자 하나마다 setState 를 하면 앱 전체가 다시 그려진다. 268KB 문서에서 재어 보니
   * 그것만으로 **한 글자에 0.35초**가 더 들었다(1.02초 → 0.66초). 화면에 보이는 것은
   * 제목과 ● 뿐이므로 그 둘만 상태로 두고, 내용은 저장할 때 여기서 꺼낸다.
   */
  const liveRef = useRef(new Map())
  const liveOf = useCallback((t) => (t ? liveRef.current.get(t.id) ?? t.content : ''), [])

  // 문서 제목 — 첫 `# 제목`, 없으면 파일 이름.
  // 화면에는 제목줄을 두지 않는다. 이 값이 가는 곳은 **창 제목(작업 표시줄)** 과 탭이다
  const [titles, setTitles] = useState({})
  const titleOf = useCallback(
    (t) => titles[t.id] ?? docTitle(t.content, t.path),
    [titles],
  )
  const title = active ? titleOf(active) : '제목 없음'

  // 제목은 자주 바뀌지 않는다. 타이핑이 멎은 뒤에 한 번만 센다
  const titleTimer = useRef(0)
  const bumpTitle = useCallback(() => {
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      const t = activeRef.current
      if (!t) return
      const next = docTitle(liveRef.current.get(t.id) ?? t.content, t.path)
      setTitles((m) => (m[t.id] === next ? m : { ...m, [t.id]: next }))
    }, TITLE_MS)
  }, [])

  // 이미지·링크 핸들러가 항상 최신 문서 경로와 설정을 보도록 ref 로 전달.
  // 내용은 파일 여는 함수가 만들어진 뒤에 채운다 (아래)
  const ctxRef = useRef({ path: null, imageDir: 'images' })

  // 콜백 안에서 최신 탭 목록을 보기 위한 미러
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active

  // 화면이 멎는 상황을 기록한다 (숨김 폴더 `.mdlog`)
  useEffect(() => startDiag('md-editor'), [])

  // 오래 걸리는 일이 있으면 무엇을 하는 중인지 말해 준다 (멎은 것으로 오해하지 않게)
  const busy = useBusy()

  /* ---------- 창 제목 ---------- */

  useEffect(() => {
    const full = `${active?.dirty ? '● ' : ''}${title} — MD Notepad v${__APP_VERSION__}`
    document.title = full
    // 창 제목을 바꾸려면 `core:window:allow-set-title` 이 있어야 한다.
    // core:default 에는 읽기(allow-title)만 있다 — 없으면 조용히 막히므로 남겨서 본다
    if (isTauri) getCurrentWindow().setTitle(full).catch((e) => note(`창 제목 실패: ${e}`))
  }, [title, active?.dirty])

  /* ---------- 알림 ---------- */

  const noticeTimer = useRef(0)
  const say = useCallback((m) => {
    setNotice(m)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 6000)
  }, [])

  /* ---------- 파일 ---------- */

  /* ---------- 최근 문서 ---------- */

  // 설정과 같은 자리에 담는다. 목록을 바꾸는 길이 하나뿐이어야 어긋나지 않는다
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const putSettings = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch }
    setSettings(next)
    saveSettings(SETTINGS_KEY, next)
  }, [])

  // 연 문서는 목록 맨 앞으로(중복은 하나만), 열리지 않은 것은 목록에서 뺀다
  const onUsed = useCallback((path, ok) => {
    const list = settingsRef.current.recent
    putSettings({ recent: ok ? pushRecent(list, path) : dropRecent(list, path) })
  }, [putSettings])

  const { openPath, openDialog, saveActive } =
    useFiles({ tabsRef, activeRef, setTabs, setActiveId, newTab, say, liveOf, onUsed })

  // 문서 안의 `[글](다른글.md)` 링크를 Ctrl+누르면 이 함수로 온다 (`linkNav.js`)
  ctxRef.current = { path: active?.path ?? null, imageDir: settings.imageDir, openFile: openPath }

  /* ---------- 외부 변경 감지 ---------- */

  const { conflicts, resolveConflict } = useExternalChanges({ tabs, tabsRef, setTabs, say, liveOf, liveRef })

  /* ---------- 탭 ---------- */

  const addTab = useCallback(() => {
    const t = newTab()
    setTabs((ts) => [...ts, t])
    setActiveId(t.id)
  }, [])

  /** 탭을 목록에서 뺀다. 물어보지 않는다 — 물어볼 일은 부르는 쪽이 먼저 한다 */
  const removeTab = useCallback((id) => {
    liveRef.current.delete(id)
    setTabs((ts) => {
      const rest = ts.filter((x) => x.id !== id)
      if (rest.length === 0) {
        const fresh = newTab()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) {
        const i = ts.findIndex((x) => x.id === id)
        setActiveId((rest[i] ?? rest[i - 1] ?? rest[0]).id)
      }
      return rest
    })
  }, [activeId])

  const closeTab = useCallback(async (id) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    if (t.dirty) {
      const ok = isTauri
        ? await confirm(`"${baseName(t.path)}" 의 변경 사항을 버릴까요?`, { title: '저장하지 않음', kind: 'warning' })
        : window.confirm('변경 사항을 버릴까요?')
      if (!ok) return
    }
    removeTab(id)
  }, [removeTab])

  /** 끌어 놓은 자리로 탭 순서를 바꾼다. `to` 는 "몇 번째 앞" 이다 */
  const reorderTab = useCallback((id, to) => {
    setTabs((ts) => {
      const from = ts.findIndex((x) => x.id === id)
      if (from < 0 || to === from || to === from + 1) return ts
      const next = [...ts]
      const [t] = next.splice(from, 1)
      next.splice(from < to ? to - 1 : to, 0, t)
      return next
    })
  }, [])

  /**
   * 창 밖으로 끌어낸 탭 — 다른 MD Notepad 창이면 그 창으로, 아니면 새 창으로.
   *
   * 넘겨받는 쪽은 **파일을 다시 읽는다.** 그래서 고친 것이 있으면 먼저 저장해야
   * 한다. 이 앱에서 진실의 원천은 언제나 실제 `.md` 파일이다.
   */
  const detachTab = useCallback(async (t) => {
    if (!isTauri) return
    if (!t.path) { say('저장하지 않은 탭은 옮길 수 없습니다 — 먼저 저장해 주세요'); return }
    try {
      if (t.dirty) await invoke('write_file', { path: t.path, contents: liveOf(t) })
      const how = await invoke('hand_off_tab', { path: t.path })
      if (how === 'self') return                      // 제 창 위에 놓았다 — 아무 일도 없다
      removeTab(t.id)
      say(how === 'moved'
        ? `${baseName(t.path)} 을(를) 다른 창으로 옮겼습니다`
        : `${baseName(t.path)} 을(를) 새 창으로 열었습니다`)
    } catch (e) {
      say(`옮기지 못했습니다: ${e}`)
    }
  }, [removeTab, say, liveOf])

  // 다른 창이 넘겨준 탭 (`handoff.rs`)
  useEffect(() => {
    if (!isTauri) return
    let unlisten
    let cancelled = false
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('tab-handoff', (e) => openPath(e.payload.path)))
      .then((un) => { if (cancelled) un(); else unlisten = un })
      .catch((e) => note(`탭 넘겨받기 실패: ${e}`))
    return () => { cancelled = true; unlisten?.() }
  }, [openPath])

  /* ---------- 위지윅으로 열리지 않는 문서 ---------- */

  /*
   * MDXEditor 는 마크다운을 MDX 로 읽는다. `{ }` 처럼 MDX 가 자기 문법으로 보는 글자가
   * 있으면 아무리 다듬어도(`normalizeMarkdown.js`) 읽지 못하는 문서가 남는다.
   *
   * 그때 빈 화면을 보여줄 이유가 없다 — **원본 모드로 다시 열고 무엇이 문제인지 말해
   * 준다.** MDXEditor 는 읽기에 실패해도 원본 글자를 그대로 들고 있고, 그 상태에서는
   * 스스로 파일을 다시 쓰지도 않는다. 그러니 원본 모드에서 고쳐 저장하면 된다.
   *
   * 다시 그리려면 리마운트해야 한다(키를 바꾼다) — 보기 모드는 편집기가 만들어질 때
   * 한 번 정해진다.
   */
  const [failed, setFailed] = useState({})
  const onEditorError = useCallback(({ error }) => {
    const t = activeRef.current
    if (!t) return
    setFailed((m) => (m[t.id] ? m : { ...m, [t.id]: true }))
    say(`위지윅으로 열 수 없어 원본 모드로 열었습니다 — ${String(error).slice(0, 120)}`)
  }, [say])

  // 두 번째 인자는 "파일을 연 직후 MDXEditor 가 스스로 다듬은 것"이라는 표시다.
  // 이걸 사용자의 편집으로 치면, 손대지도 않은 문서가 수정됨으로 잡혀
  // 저장 한 번에 파일이 통째로 다시 쓰인다(물결·밑줄이 이스케이프된다).
  const onEditorChange = useCallback((md, initialNormalize) => {
    const t = activeRef.current
    if (!t || md === liveOf(t)) return
    liveRef.current.set(t.id, md)          // 내용은 여기까지. 다시 그리지 않는다
    bumpTitle()
    // ● 는 한 번만 켜면 된다. 매번 켜면 그때마다 앱이 다시 그려진다
    if (!initialNormalize && !t.dirty) {
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: true } : x)))
    }
  }, [liveOf, bumpTitle])

  /* ---------- 드래그 앤 드롭 (상단에 놓아야 열린다) ---------- */

  const onDrop = useCallback((paths, inTop) => {
    if (!inTop) { say('맨 위 탭 줄에 놓아야 파일이 열립니다'); return }
    const md = paths.filter((p) => OPENABLE.test(p))
    if (md.length === 0) { say('마크다운 파일(.md · .markdown · .mdx · .txt)만 열 수 있습니다'); return }
    md.forEach(openPath)
  }, [openPath, say])

  const dropWhere = useFileDrop(topRef, onDrop)

  /* ---------- 탐색기에서 열기 (명령줄 인자) ---------- */

  useEffect(() => {
    if (!isTauri) return
    invoke('startup_file')
      .then((p) => { if (p) openPath(p) })
      .catch(() => { /* 인자 없이 실행된 보통의 경우 */ })
  }, [openPath])

  /* ---------- 단축키 ---------- */

  useShortcuts({
    open: openDialog,
    save: saveActive,
    newTab: addTab,
    close: () => closeTab(activeId),
    cycle: (dir) => {
      const ts = tabsRef.current
      const i = ts.findIndex((x) => x.id === activeId)
      setActiveId(ts[(i + dir + ts.length) % ts.length].id)
    },
  })

  /* ---------- 렌더 ---------- */

  return (
    <>
      <div
        ref={topRef}
        className={'topzone' + (dropWhere ? ` drop-${dropWhere}` : '')}
      >
        <TabBar
          tabs={tabs}
          titleOf={titleOf}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onAdd={addTab}
          onReorder={reorderTab}
          onDetach={detachTab}
          recent={settings.recent}
          onPickRecent={openPath}
          onClearRecent={() => putSettings({ recent: [] })}
          onOpen={openDialog}
          onSave={() => saveActive(false)}
          onSaveAs={() => saveActive(true)}
          onSettings={() => setShowSettings((v) => !v)}
        />
      </div>

      {showSettings && (
        <SettingsBar settings={settings} onChange={putSettings} path={active?.path} />
      )}

      <SplitEditor
        key={active.id + (failed[active.id] ? '·source' : '')}
        // 원본 모드로 떨어질 때는 다시 마운트된다. 그때 넘길 것은 파일을 열 때의 글자가
        // 아니라 **지금 편집 중인 글자**다 (`liveOf`) — 아니면 고치던 것이 사라진다
        markdown={liveOf(active)}
        viewMode={failed[active.id] ? 'source' : initialViewMode(active.content, settings.bigDocSource)}
        onChange={onEditorChange}
        onError={onEditorError}
        ctxRef={ctxRef}
        wide={settings.wideLayout}
      />

      {dropWhere && (
        <div className={'drop-hint' + (dropWhere === 'out' ? ' warn' : '')}>
          {dropWhere === 'in'
            ? '놓으면 새 탭으로 열립니다'
            : '↑ 맨 위 탭 줄에 놓으세요'}
        </div>
      )}
      {busy && <div className="drop-hint">{busy}</div>}
      {!busy && notice && <div className="drop-hint warn">{notice}</div>}

      {conflicts.length > 0 && (
        <ReloadDialog
          path={conflicts[0].path}
          mine={conflicts[0].mine}
          theirs={conflicts[0].text}
          onReload={() => resolveConflict(conflicts[0].path, 'reload')}
          onOverwrite={() => resolveConflict(conflicts[0].path, 'overwrite')}
        />
      )}
    </>
  )
}
