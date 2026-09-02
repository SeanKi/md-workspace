import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { normalizeForEditor } from '@md/editor-core'
import useFileWatch from './useFileWatch.js'
import { baseName } from './paths.js'

/**
 * 열어 둔 파일이 밖에서 바뀌었을 때의 처리.
 *
 * 내 편집분이 없으면 물어볼 것이 없으므로 그냥 다시 읽는다.
 * 편집분이 있을 때만 사용자에게 고르게 한다 — 불러오기 / 덮어쓰기.
 *
 * @returns {{ conflicts: string[], resolveConflict: (path, 'reload'|'overwrite') => void }}
 */
export default function useExternalChanges({ tabs, tabsRef, setTabs, say }) {
  const [conflicts, setConflicts] = useState([])

  /** 파일을 다시 읽어 탭에 넣는다. 이미 읽어 둔 내용이 있으면 그걸 쓴다. */
  const reloadTab = useCallback(async (path, known) => {
    try {
      const text = known ?? normalizeForEditor(await invoke('read_file', { path })).text
      // key 를 바꿔 에디터를 다시 마운트한다. 한 인스턴스에 새 내용을 밀어 넣으면
      // 되돌리기 이력이 엉킨다 (CLAUDE.md 참고)
      setTabs((ts) => ts.map((x) => (
        x.path === path ? { ...x, id: `${x.id}r${Date.now()}`, content: text, dirty: false } : x
      )))
      say(`${baseName(path)} 을(를) 다시 읽었습니다`)
    } catch (e) {
      say(`다시 읽을 수 없습니다: ${e}`)
    }
  }, [setTabs, say])

  const onExternalChange = useCallback(async (path) => {
    const t = tabsRef.current.find((x) => x.path === path)
    if (!t) return
    if (!t.dirty) { reloadTab(path); return }
    // 무엇이 달라졌는지 보여주려면 파일 내용이 있어야 한다.
    // 여기서 한 번 읽어 두고, 불러오기를 고르면 그대로 쓴다.
    let text = ''
    try {
      text = normalizeForEditor(await invoke('read_file', { path })).text
    } catch (e) {
      say(`파일을 읽을 수 없습니다: ${e}`)
      return
    }
    setConflicts((c) => (
      c.some((x) => x.path === path) ? c : [...c, { path, text, mine: t.content }]
    ))
  }, [tabsRef, reloadTab, say])

  useFileWatch(tabs.map((t) => t.path), onExternalChange)

  const resolveConflict = useCallback(async (path, how) => {
    const item = conflicts.find((x) => x.path === path)
    setConflicts((c) => c.filter((x) => x.path !== path))
    if (how === 'reload') { await reloadTab(path, item?.text); return }

    const t = tabsRef.current.find((x) => x.path === path)
    if (!t) return
    try {
      await invoke('write_file', { path, contents: t.content })
      setTabs((ts) => ts.map((x) => (x.path === path ? { ...x, dirty: false } : x)))
      say(`${baseName(path)} 을(를) 내 내용으로 덮어썼습니다`)
    } catch (e) {
      say(`저장 실패: ${e}`)
    }
  }, [conflicts, tabsRef, setTabs, reloadTab, say])

  return { conflicts, resolveConflict }
}
