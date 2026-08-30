import React, { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save, confirm } from '@tauri-apps/plugin-dialog'
import { Editor, isTauri, loadSettings, saveSettings, normalizeVoidTags } from '@md/editor-core'
import useFileDrop from './useFileDrop.js'
import TabBar from './TabBar.jsx'
import SettingsBar from './SettingsBar.jsx'
import useShortcuts from './useShortcuts.js'
import { MD_FILTER, OPENABLE, baseName } from './paths.js'

const SETTINGS_KEY = 'md-editor-settings'

const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)

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

  // 이미지 핸들러가 항상 최신 문서 경로와 설정을 보도록 ref 로 전달
  const ctxRef = useRef({ path: null, imageDir: 'images' })
  ctxRef.current = { path: active?.path ?? null, imageDir: settings.imageDir }

  // 콜백 안에서 최신 탭 목록을 보기 위한 미러
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active

  /* ---------- 알림 ---------- */

  const noticeTimer = useRef(0)
  const say = useCallback((m) => {
    setNotice(m)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 3600)
  }, [])

  /* ---------- 파일 ---------- */

  const openPath = useCallback(async (p) => {
    const found = tabsRef.current.find((t) => t.path === p)
    if (found) { setActiveId(found.id); return }
    try {
      const raw = await invoke('read_file', { path: p })
      // MDXEditor 는 `<br>` 을 못 읽는다. 열 때 `<br />` 로 맞춰 준다
      const { text: content, count } = normalizeVoidTags(raw)
      if (count) say(`닫히지 않은 <br> 태그 ${count}개를 <br /> 로 고쳐 열었습니다. 저장하면 파일에 반영됩니다`)
      const t = newTab(p, content)
      setTabs((ts) => {
        // 손대지 않은 빈 탭 하나만 있으면 그 자리를 대신 쓴다
        const blank = ts.length === 1 && !ts[0].path && !ts[0].dirty && !ts[0].content
        return blank ? [t] : [...ts, t]
      })
      setActiveId(t.id)
    } catch (e) {
      alert(`열 수 없습니다: ${p}\n${e}`)
    }
  }, [say])

  const openDialog = useCallback(async () => {
    const p = pickPath(await open({ multiple: false, filters: MD_FILTER }))
    if (p) openPath(p)
  }, [openPath])

  const saveActive = useCallback(async (asNew = false) => {
    const t = activeRef.current
    if (!t) return
    let p = t.path
    if (!p || asNew) {
      p = pickPath(await save({ filters: MD_FILTER, defaultPath: t.path ?? 'untitled.md' }))
      if (!p) return
    }
    await invoke('write_file', { path: p, contents: t.content })
    setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, path: p, dirty: false } : x)))
  }, [])

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

  const onEditorChange = useCallback((md) => {
    const t = activeRef.current
    if (!t || md === t.content) return
    setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, content: md, dirty: true } : x)))
  }, [])

  /* ---------- 드래그 앤 드롭 (상단에 놓아야 열린다) ---------- */

  const onDrop = useCallback((paths, inTop) => {
    if (!inTop) { say('상단 제목줄·탭 영역에 놓아야 파일이 열립니다'); return }
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
        <div className="titlebar">
          <span className="path">{active?.path ?? ''}</span>
          <span className="spacer" />
          <button onClick={addTab} title="Ctrl+T">새 탭</button>
          <button onClick={openDialog} title="Ctrl+O">열기</button>
          <button onClick={() => saveActive(false)} title="Ctrl+S">저장</button>
          <button onClick={() => saveActive(true)} title="Ctrl+Shift+S">다른 이름으로</button>
          <button onClick={() => setShowSettings((v) => !v)} title="설정">⚙</button>
        </div>

        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onAdd={addTab}
        />
      </div>

      {showSettings && <SettingsBar settings={settings} onChange={updateSettings} />}

      <div className="editor-wrap">
        <Editor
          key={active.id}
          markdown={active.content}
          onChange={onEditorChange}
          ctxRef={ctxRef}
        />
      </div>

      {dropWhere && (
        <div className={'drop-hint' + (dropWhere === 'out' ? ' warn' : '')}>
          {dropWhere === 'in'
            ? '놓으면 새 탭으로 열립니다'
            : '↑ 상단 제목줄·탭 영역에 놓으세요'}
        </div>
      )}
      {notice && <div className="drop-hint warn">{notice}</div>}
    </>
  )
}
