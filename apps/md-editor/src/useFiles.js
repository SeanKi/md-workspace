import { useCallback } from 'react'
import { invoke } from '@md/editor-core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { normalizeForEditor, describeFixes, bigDocNotice, samePath } from '@md/editor-core'
import { MD_FILTER, baseName } from './paths.js'

const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)

/**
 * 파일 열기·저장. 탭 상태는 넘겨받은 setter 로만 건드린다.
 *
 * `onUsed(경로, 열렸는가)` 로 최근 문서 목록을 알린다 — 열리지 않은 것은 목록에서
 * 빠져야 한다(지웠거나 옮긴 파일).
 */
export default function useFiles({ tabsRef, activeRef, setTabs, setActiveId, newTab, say, liveOf, onUsed, addWithRoom }) {
  const openPath = useCallback(async (p) => {
    const found = tabsRef.current.find((t) => samePath(t.path, p))
    if (found) { setActiveId(found.id); onUsed?.(p, true); return }
    try {
      const raw = await invoke('read_file', { path: p })
      // MDXEditor 는 MDX 로 읽어서 태그가 아닌 `<` 를 만나면 파싱이 실패한다
      const { text: content, count, stat } = normalizeForEditor(raw)
      const big = bigDocNotice(content)
      if (count) say(`${describeFixes(stat)}를 고쳐 열었습니다. 저장하면 파일에 반영됩니다`)
      else if (big) say(big)
      // 탭이 넘치면 가장 오래 안 본 탭을 닫아 자리를 만든다 (App.jsx)
      if (!addWithRoom(newTab(p, content))) return
      onUsed?.(p, true)
    } catch (e) {
      onUsed?.(p, false)
      alert(`열 수 없습니다: ${p}\n${e}`)
    }
  }, [tabsRef, setActiveId, newTab, say, onUsed, addWithRoom])

  const openDialog = useCallback(async () => {
    const p = pickPath(await open({ multiple: false, filters: MD_FILTER }))
    if (p) openPath(p)
  }, [openPath])

  const saveActive = useCallback(async (asNew = false) => {
    const t = activeRef.current
    if (!t) return null
    let p = t.path
    if (!p || asNew) {
      p = pickPath(await save({ filters: MD_FILTER, defaultPath: t.path ?? 'untitled.md' }))
      if (!p) return null
    }
    // 저장은 **말해 줘야 한다.** 고쳐 열기만 한 문서는 ● 가 없어서, 눌러도 화면에
    // 아무 변화가 없으면 "눌리지 않았다" 로 보인다. 실패도 마찬가지다 —
    // 여기서 삼키면 읽기 전용 파일이나 사라진 폴더가 조용히 넘어간다
    try {
      // 편집 중인 내용은 상태가 아니라 ref 에 있다 (App.jsx 참고)
      await invoke('write_file', { path: p, contents: liveOf(t) })
      setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, path: p, dirty: false } : x)))
      onUsed?.(p, true)
      say(`저장했습니다 — ${baseName(p)}`)
      return p
    } catch (e) {
      say(`저장하지 못했습니다: ${e}`)
      return null
    }
  }, [activeRef, setTabs, liveOf, onUsed, say])

  return { openPath, openDialog, saveActive }
}
