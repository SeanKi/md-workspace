/** 노트를 바깥으로 내보내는 것들 — 다른 앱으로 열기, 경로를 클립보드에. */

import { invoke, isTauri } from '@md/editor-core'

const demo = () => Promise.reject(new Error('브라우저 데모 모드에서는 할 수 없습니다.'))

/** MD Notepad 에 경로를 넘겨 띄운다. 실행 파일은 이 앱 옆에 있어야 한다 */
export const openInMdEditor = (path) => (isTauri ? invoke('open_in_md_editor', { path }) : demo())

/** MD Notepad 가 옆에 있는가. 없으면 메뉴에 항목을 내지 않는다 */
export const hasMdEditor = () => (isTauri ? invoke('has_md_editor') : Promise.resolve(false))

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
