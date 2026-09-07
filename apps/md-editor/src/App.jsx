import React, { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@md/editor-core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm } from '@tauri-apps/plugin-dialog'
import { SplitEditor, isTauri, loadSettings, saveSettings, startDiag, useBusy, note } from '@md/editor-core'
import useFileDrop from './useFileDrop.js'
import TabBar from './TabBar.jsx'
import SettingsBar from './SettingsBar.jsx'
import useShortcuts from './useShortcuts.js'
import useFiles from './useFiles.js'
import useExternalChanges from './useExternalChanges.js'
import ReloadDialog from './ReloadDialog.jsx'
import { OPENABLE, baseName, docTitle } from './paths.js'

const SETTINGS_KEY = 'md-editor-settings'
/** 타이핑이 멎고 이만큼 지나면 제목을 다시 센다 */
const TITLE_MS = 500

let seq = 0
const newTab = (path = null, content = '') => ({
  id: `t${++seq}`, path, content, dirty: false,
})

export default function App() {
  const [tabs, setTabs] = useState(() => [newTab()])
  const [activeId, setActiveId] = useState('t1')
  const [settings, setSettings] = useState(() => loadSettings(SETTINGS_KEY))
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

  // 이미지 핸들러가 항상 최신 문서 경로와 설정을 보도록 ref 로 전달
  const ctxRef = useRef({ path: null, imageDir: 'images' })
  ctxRef.current = { path: active?.path ?? null, imageDir: settings.imageDir }

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

  const { openPath, openDialog, saveActive } =
    useFiles({ tabsRef, activeRef, setTabs, setActiveId, newTab, say, liveOf })

  /* ---------- 외부 변경 감지 ---------- */

  const { conflicts, resolveConflict } = useExternalChanges({ tabs, tabsRef, setTabs, say, liveOf, liveRef })

  /* ---------- 탭 ---------- */

  const addTab = useCallback(() => {
    const t = newTab()
    setTabs((ts) => [...ts, t])
    setActiveId(t.id)
  }, [])

  const closeTab = useCallback(async (id) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    if (t.dirty) {
      const ok = isTauri
        ? await confirm(`"${baseName(t.path)}" 의 변경 사항을 버릴까요?`, { title: '저장하지 않음', kind: 'warning' })
        : window.confirm('변경 사항을 버릴까요?')
      if (!ok) return
    }
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

  /* ---------- 설정 ---------- */

  const updateSettings = (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(SETTINGS_KEY, next)
  }

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
          onOpen={openDialog}
          onSave={() => saveActive(false)}
          onSaveAs={() => saveActive(true)}
          onSettings={() => setShowSettings((v) => !v)}
        />
      </div>

      {showSettings && (
        <SettingsBar settings={settings} onChange={updateSettings} path={active?.path} />
      )}

      <SplitEditor
        key={active.id}
        markdown={active.content}
        onChange={onEditorChange}
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
