import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { normalizeForEditor, describeFixes } from '@md/editor-core'
import { MD_FILTER } from './paths.js'

const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)

/** 파일 열기·저장. 탭 상태는 넘겨받은 setter 로만 건드린다. */
export default function useFiles({ tabsRef, activeRef, setTabs, setActiveId, newTab, say }) {
  const openPath = useCallback(async (p) => {
    const found = tabsRef.current.find((t) => t.path === p)
    if (found) { setActiveId(found.id); return }
    try {
      const raw = await invoke('read_file', { path: p })
      // MDXEditor 는 MDX 로 읽어서 태그가 아닌 `<` 를 만나면 파싱이 실패한다
      const { text: content, count, stat } = normalizeForEditor(raw)
      if (count) say(`${describeFixes(stat)}를 고쳐 열었습니다. 저장하면 파일에 반영됩니다`)
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
  }, [tabsRef, setTabs, setActiveId, newTab, say])

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
  }, [activeRef, setTabs])

  return { openPath, openDialog, saveActive }
}
