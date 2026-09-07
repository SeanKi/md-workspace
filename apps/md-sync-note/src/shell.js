/** 노트를 바깥으로 내보내는 것들 — 다른 앱으로 열기, 경로를 클립보드에. */

import { invoke, isTauri } from '@md/editor-core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

const demo = () => Promise.reject(new Error('브라우저 데모 모드에서는 할 수 없습니다.'))

/**
 * MD Notepad 에 경로를 넘겨 띄운다.
 * `exe` 는 설정에 적어 둔 실행 파일 경로(없으면 Rust 가 알아서 찾는다 — `open_with.rs`).
 */
export const openInMdEditor = (path, exe) => (
  isTauri ? invoke('open_in_md_editor', { path, exe: exe || null }) : demo()
)

/** 지금 찾아지는 MD Notepad 의 경로. 없으면 빈 글자 */
export const mdNotepadPath = (exe) => (
  isTauri ? invoke('md_notepad_path', { exe: exe || null }) : Promise.resolve('')
)

/** 실행 파일을 직접 고르게 한다. 취소하면 빈 글자 */
export async function pickMdNotepad() {
  if (!isTauri) return ''
  const picked = await openDialog({
    title: 'MD Notepad 실행 파일을 고르세요',
    multiple: false,
    filters: [{ name: '실행 파일', extensions: ['exe'] }],
  })
  return (typeof picked === 'string' ? picked : picked?.path) ?? ''
}

/**
 * 클립보드에 글자를 넣는다.
 *
 * WebView2 는 `tauri.localhost` 를 안전한 출처로 쳐서 `navigator.clipboard` 가
 * 동작한다. 그래도 창이 포커스를 잃은 순간 등에는 거절당하므로 옛 방식으로 한 번 더
 * 시도한다. 이것 때문에 클립보드 플러그인을 더 붙일 이유는 없다.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch { /* 아래에서 한 번 더 */ }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('클립보드에 넣지 못했습니다.')
}
