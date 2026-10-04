import { useEffect, useRef } from 'react'
import { invoke, isTauri, note } from './core.js'

/*
 * MD Notepad 에서 가져온 "아무 파일이나 열기" 길들.
 *
 * - 명령줄 (탐색기 "MD Tiptap으로 열기") — 뜰 때 한 번 `startup_file`
 * - 이미 떠 있는 창에 또 열기 — 두 번째 실행이 `open-files` 로 넘겨준다 (lib.rs single-instance)
 * - 창에 끌어다 놓기 — Tauri 가 OS 레벨에서 드롭을 가로채므로 `onDragDropEvent` 로 받는다
 *   (CLAUDE.md). MD Notepad 는 탭 줄에 놓았을 때만 열었지만, 여기는 본문에 그림을 놓는
 *   동작이 없으므로 창 어디든 열어 준다
 */

const MD = /\.(md|markdown|mdx|txt)$/i
export const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }]
const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)

export async function pickOpenPaths() {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({ multiple: true, filters: MD_FILTER })
  return (Array.isArray(r) ? r : r ? [r] : []).map(pickPath).filter(Boolean)
}

export async function pickSavePath(defaultPath) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return pickPath(await save({ filters: MD_FILTER, defaultPath: defaultPath || '새 문서.md' }))
}

export default function useNotepad(openDoc, ready) {
  const open = useRef(openDoc)
  open.current = openDoc

  useEffect(() => {
    if (!isTauri) return
    const offs = []
    let cancelled = false
    const keep = (un) => { if (cancelled) un(); else offs.push(un) }

    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('open-files', (e) => { for (const p of e.payload ?? []) open.current(p) }))
      .then(keep)

    import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type !== 'drop') return
        for (const p of e.payload.paths ?? []) if (MD.test(p)) open.current(p)
      }))
      .then(keep)

    return () => { cancelled = true; offs.forEach((un) => un()) }
  }, [])

  // 명령줄로 받은 파일은 설정(최근 목록)을 다 읽은 **뒤에** 연다. 먼저 열면 설정을 읽으면서
  // 최근 목록이 덮여 방금 연 파일이 빠진다
  useEffect(() => {
    if (!isTauri || !ready) return
    invoke('startup_file').then((p) => { if (p) open.current(p) }).catch((e) => note(`시작 파일: ${e}`))
  }, [ready])
}
