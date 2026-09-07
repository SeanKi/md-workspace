/**
 * 환경 정보를 **실행 파일 옆 `MDSyncNote.ini`** 에 담는다 (`config.rs`).
 *
 * 전에는 localStorage 에 있었다. WebView2 의 사용자 데이터 폴더 안에 숨어 있어서
 * 어디에 있는지 알 수 없고, 지우면 같이 날아가고, 다른 기기로 옮길 수도 없었다.
 *
 * 쓰기는 **모아서 한 번에** 한다 — 사이드바 폭을 끌 때마다 파일을 쓸 수는 없다.
 * 창을 닫을 때도 한 번 밀어 넣는다(`beforeunload`).
 *
 * 브라우저 데모 모드에는 실행 파일이 없다. 그때만 localStorage 를 쓴다.
 */

import { invoke, isTauri } from '@md/editor-core'

const LS_REPOS = 'md-sync-note-repos'
const LS_SETTINGS = 'md-sync-note-settings'
const SAVE_MS = 400

/* ---------- 값 옮기기 (INI 는 전부 글자다) ---------- */

const toIni = (v) => String(v)

function fromIni(text, sample) {
  if (typeof sample === 'number') { const n = Number(text); return Number.isFinite(n) ? n : sample }
  if (typeof sample === 'boolean') return text === 'true'
  return text
}

/** { settings, repos } → INI 구획 */
function pack(settings, repos) {
  const data = { settings: {} }
  for (const [k, v] of Object.entries(settings)) data.settings[k] = toIni(v)
  repos.forEach((r, i) => {
    data[`repo.${i + 1}`] = { name: r.name, path: r.path, kind: r.kind ?? 'local' }
  })
  return data
}

/** INI 구획 → { settings, repos } */
function unpack(data, defaults) {
  const settings = { ...defaults }
  for (const [k, v] of Object.entries(data.settings ?? {})) {
    if (k in defaults) settings[k] = fromIni(v, defaults[k])
  }
  const repos = Object.keys(data)
    .filter((s) => s.startsWith('repo.'))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((s, i) => ({
      id: `r${i + 1}`, name: data[s].name || '', kind: data[s].kind || 'local', path: data[s].path || '',
    }))
    .filter((r) => r.path)
  return { settings, repos }
}

/* ---------- 읽기 ---------- */

const readLocal = (defaults) => ({
  settings: { ...defaults, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') },
  repos: JSON.parse(localStorage.getItem(LS_REPOS) || '[]'),
})

/**
 * @returns {{ settings, repos, path: string, note: string }}
 *          note 는 화면에 한 줄 알릴 말 (없으면 빈 글자)
 */
export async function loadConfig(defaults) {
  if (!isTauri) {
    try { return { ...readLocal(defaults), path: '(브라우저)', note: '' } } catch { /* 아래 */ }
    return { settings: { ...defaults }, repos: [], path: '(브라우저)', note: '' }
  }

  const path = await invoke('config_path').catch(() => 'MDSyncNote.ini')
  let data
  try {
    data = await invoke('config_load')
  } catch (e) {
    return { settings: { ...defaults }, repos: [], path, note: String(e) }
  }

  // 파일이 아직 없다 — 쓰던 것이 localStorage 에 있으면 그것을 옮겨 담는다
  if (Object.keys(data).length === 0) {
    let old = { settings: { ...defaults }, repos: [] }
    try { old = readLocal(defaults) } catch { /* 없으면 기본값 */ }
    const moved = old.repos.length > 0
    await saveConfigNow(old.settings, old.repos).catch(() => {})
    return { ...old, path, note: moved ? `설정을 ${path} 로 옮겼습니다` : '' }
  }

  return { ...unpack(data, defaults), path, note: '' }
}

/* ---------- 쓰기 ---------- */

export async function saveConfigNow(settings, repos) {
  if (!isTauri) {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
      localStorage.setItem(LS_REPOS, JSON.stringify(repos))
    } catch { /* 무시 */ }
    return
  }
  await invoke('config_save', { data: pack(settings, repos) })
}

let timer = 0
let pending = null
let onError = null

/** 실패를 알리고 싶으면 한 번 걸어 둔다 */
export const onConfigError = (fn) => { onError = fn }

/** 모아서 쓴다. 같은 순간에 여러 번 불러도 파일은 한 번만 쓰인다 */
export function saveConfig(settings, repos) {
  pending = { settings, repos }
  clearTimeout(timer)
  timer = setTimeout(flushConfig, SAVE_MS)
}

export function flushConfig() {
  clearTimeout(timer)
  if (!pending) return
  const { settings, repos } = pending
  pending = null
  saveConfigNow(settings, repos).catch((e) => onError?.(String(e)))
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushConfig)
