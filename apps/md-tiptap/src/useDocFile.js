import { useCallback } from 'react'
import { invoke, note } from '@md/editor-core/src/diag.js'
import { isTauri } from '@md/editor-core/src/tauriBridge.js'

/*
 * 파일 열기·저장. Tauri 에서는 Rust 커맨드(md-core), 브라우저에서는 파일 고르기와
 * 내려받기로 한다 — 같은 화면을 웹에서도 시험해 보기 위해서.
 */

const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)

function pickInBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain'
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? { path: null, name: f.name, text: await f.text() } : null)
    }
    input.click()
  })
}

function downloadInBrowser(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  a.download = name || 'untitled.md'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function useDocFile({ say }) {
  const readPath = useCallback(async (path) => {
    try {
      return { path, name: path.split(/[\\/]/).pop(), text: await invoke('read_file', { path }) }
    } catch (e) {
      say(`열 수 없습니다: ${e}`)
      return null
    }
  }, [say])

  const openDialog = useCallback(async () => {
    if (!isTauri) return pickInBrowser()
    const { open } = await import('@tauri-apps/plugin-dialog')
    const p = pickPath(await open({ multiple: false, filters: MD_FILTER }))
    return p ? readPath(p) : null
  }, [readPath])

  /** @returns 저장한 경로 (브라우저는 내려받은 이름). 취소하면 null */
  const save = useCallback(async ({ path, name }, text, asNew = false) => {
    if (!isTauri) { downloadInBrowser(name, text); return name || 'untitled.md' }
    let p = path
    if (!p || asNew) {
      const { save: saveDialog } = await import('@tauri-apps/plugin-dialog')
      p = pickPath(await saveDialog({ filters: MD_FILTER, defaultPath: path ?? name ?? 'untitled.md' }))
      if (!p) return null
    }
    try {
      await invoke('write_file', { path: p, contents: text })
      return p
    } catch (e) {
      note(`저장 실패: ${e}`)
      say(`저장하지 못했습니다: ${e}`)
      return null
    }
  }, [say])

  return { readPath, openDialog, save }
}
