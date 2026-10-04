import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, isTauri, samePath } from './core.js'
import { baseName } from './repos.js'

/*
 * 열어 둔 파일이 밖에서 바뀌었을 때 (md-editor/useExternalChanges.js + useFileWatch.js 를
 * 하나로 가져왔다).
 *
 * - 감시는 Rust(md-core/watcher.rs)가 폴더를 보고 **내용 해시**로 판단한다. 우리가 저장해서
 *   생긴 변화는 여기까지 오지 않는다
 * - 내 편집분이 없으면 물을 것이 없으므로 그냥 다시 읽는다
 * - 편집분이 있을 때만 고르게 한다 — 불러오기 / 덮어쓰기 (ReloadDialog.jsx)
 *
 * 다시 읽을 때는 탭 id 를 바꿔 편집기를 다시 만든다. 한 편집기에 새 내용을 밀어 넣으면
 * 되돌리기 이력이 엉킨다 (CLAUDE.md "문서 전환은 key= 로")
 */
export default function useExternalChanges({ tabs, tabsRef, setTabs, setActiveId, activeIdRef, say, liveOf, liveRef }) {
  const [conflicts, setConflicts] = useState([])

  const reloadTab = useCallback(async (path, known) => {
    try {
      const text = known ?? await invoke('read_file', { path })
      setTabs((ts) => ts.map((x) => {
        if (!samePath(x.path, path)) return x
        const id = `${x.id}r${Date.now()}`
        liveRef.current.delete(x.id)
        if (activeIdRef.current === x.id) setActiveId(id)
        return { ...x, id, content: text, dirty: false }
      }))
      say(`${baseName(path)} 을(를) 다시 읽었습니다 — 밖에서 바뀌었습니다`)
    } catch (e) {
      say(`다시 읽을 수 없습니다: ${e}`)
    }
  }, [setTabs, setActiveId, activeIdRef, say, liveRef])

  const onExternalChange = useCallback(async (path) => {
    const t = tabsRef.current.find((x) => samePath(x.path, path))
    if (!t) return
    if (!t.dirty) { reloadTab(t.path); return }
    let text = ''
    try {
      text = await invoke('read_file', { path: t.path })
    } catch (e) {
      say(`파일을 읽을 수 없습니다: ${e}`)
      return
    }
    setConflicts((c) => (c.some((x) => samePath(x.path, t.path)) ? c : [...c, { path: t.path, text, mine: liveOf(t) }]))
  }, [tabsRef, reloadTab, say, liveOf])

  // 이벤트 구독은 한 번만
  const cb = useRef(onExternalChange)
  cb.current = onExternalChange
  useEffect(() => {
    if (!isTauri) return
    let unlisten
    let cancelled = false
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('file-changed', (e) => { cb.current(e.payload.path) }))
      .then((un) => { if (cancelled) un(); else unlisten = un })
    return () => { cancelled = true; unlisten?.() }
  }, [])

  // 탭 목록이 바뀔 때마다 감시 목록을 차이만큼만 맞춘다
  const watching = useRef(new Set())
  const paths = tabs.map((t) => t.path).filter(Boolean)
  useEffect(() => {
    if (!isTauri) return
    const want = new Set(paths)
    const have = watching.current
    for (const p of want) {
      if (have.has(p)) continue
      have.add(p)
      invoke('watch_file', { path: p }).catch(() => have.delete(p))
    }
    for (const p of [...have]) {
      if (want.has(p)) continue
      have.delete(p)
      invoke('unwatch_file', { path: p }).catch(() => {})
    }
  }, [paths.join('\n')])   // eslint-disable-line react-hooks/exhaustive-deps

  const resolveConflict = useCallback(async (path, how) => {
    const item = conflicts.find((x) => x.path === path)
    setConflicts((c) => c.filter((x) => x.path !== path))
    if (how === 'reload') { await reloadTab(path, item?.text); return }
    const t = tabsRef.current.find((x) => samePath(x.path, path))
    if (!t) return
    try {
      await invoke('write_file', { path, contents: liveOf(t) })
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, dirty: false } : x)))
      say(`${baseName(path)} 을(를) 내 내용으로 덮어썼습니다`)
    } catch (e) {
      say(`저장 실패: ${e}`)
    }
  }, [conflicts, tabsRef, setTabs, reloadTab, say, liveOf])

  return { conflicts, resolveConflict, externalChanged: onExternalChange }
}
