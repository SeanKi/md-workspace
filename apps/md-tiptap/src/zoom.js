/**
 * 화면 확대·축소: **Ctrl+마우스 휠** (10% 씩), **Ctrl+0** = 100%.
 *
 * 범위는 아래 ZOOM_MIN ~ ZOOM_MAX (75% ~ 200%) — 나중에 바꾸려면 여기만 고치면 된다.
 * 실행 파일에서는 WebView 자체의 확대(`setZoom`)를 써서 배치가 깨지지 않고,
 * 브라우저 데모 모드에서는 body 의 CSS zoom 으로 흉내 낸다.
 * 마지막 비율은 이 기기에 기억한다 (localStorage — 기기마다 화면이 달라 INI 로 옮기지 않는다).
 */

import { isTauri } from './core.js'

export const ZOOM_MIN = 75
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10

const KEY = 'md-tiptap-zoom'
const clamp = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z)))

let zoom = clamp(Number(localStorage.getItem(KEY)) || 100)
let webview = null

async function apply(z) {
  zoom = clamp(z)
  try { localStorage.setItem(KEY, String(zoom)) } catch { /* 저장 못 해도 이번 창에는 적용 */ }
  if (isTauri) {
    if (!webview) webview = (await import('@tauri-apps/api/webview')).getCurrentWebview()
    await webview.setZoom(zoom / 100)
  } else {
    document.body.style.zoom = String(zoom / 100)
  }
}

/* ---------- 비율을 잠깐 보여 주기 ---------- */

let badge = null
let badgeTimer = 0

function show(text) {
  if (!badge) {
    badge = document.createElement('div')
    Object.assign(badge.style, {
      position: 'fixed', left: '50%', top: '45%', transform: 'translate(-50%, -50%)',
      background: 'rgba(40,40,40,.85)', color: '#fff', padding: '8px 18px', borderRadius: '6px',
      font: '18px "Segoe UI", sans-serif', zIndex: 100000, pointerEvents: 'none',
    })
    document.body.appendChild(badge)
  }
  badge.textContent = text
  badge.style.display = 'block'
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => { badge.style.display = 'none' }, 900)
}

function set(next) {
  const z = clamp(next)
  if (z !== zoom) apply(z)
  show(z === ZOOM_MIN || z === ZOOM_MAX ? `${z}%  (${ZOOM_MIN}% ~ ${ZOOM_MAX}%)` : `${z}%`)
}

/* ---------- 입력 ---------- */

// 휠: 10% 단위에 맞춰 한 칸씩 (95% → 100%, 105% → 100%)
window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  const up = e.deltaY < 0
  set(up ? (Math.floor(zoom / ZOOM_STEP) + 1) * ZOOM_STEP : (Math.ceil(zoom / ZOOM_STEP) - 1) * ZOOM_STEP)
}, { passive: false, capture: true })

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === '0' || e.code === 'Numpad0')) {
    e.preventDefault()
    set(100)
  }
}, true)

// 시작할 때 지난번 비율로
if (zoom !== 100) apply(zoom)
