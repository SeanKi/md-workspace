/**
 * 환경 정보를 **실행 파일 옆 `MDTiptap.ini` (폰은 앱 데이터 폴더)** 에 담는다 (`config.rs`).
 *
 * 전에는 localStorage 에 있었다. WebView2 의 사용자 데이터 폴더 안에 숨어 있어서
 * 어디에 있는지 알 수 없고, 지우면 같이 날아가고, 다른 기기로 옮길 수도 없었다.
 *
 * 쓰기는 **모아서 한 번에** 한다 — 사이드바 폭을 끌 때마다 파일을 쓸 수는 없다.
 * 창을 닫을 때도 한 번 밀어 넣는다(`beforeunload`).
 *
 * 브라우저 데모 모드에는 실행 파일이 없다. 그때만 localStorage 를 쓴다.
 */

import { invoke, isTauri } from './core.js'

const LS_REPOS = 'md-tiptap-repos'
const LS_SETTINGS = 'md-tiptap-settings'
const LS_RECENT = 'md-tiptap-recent'
const SAVE_MS = 400

/* ---------- 값 옮기기 (INI 는 전부 글자다) ---------- */

const toIni = (v) => String(v)

function fromIni(text, sample) {
  if (typeof sample === 'number') { const n = Number(text); return Number.isFinite(n) ? n : sample }
  if (typeof sample === 'boolean') return text === 'true'
  return text
}

/**
 * { settings, repos, recent } → INI 구획
 *
 * 최근 목록은 **`[recent]` 한 구획에 번호를 매겨** 담는다. 설정값처럼 한 줄에
 * 이어 붙일 수는 없다 — 경로에는 쉼표도 세미콜론도 들어갈 수 있다.
 */
function pack(settings, repos, recent) {
  const data = { settings: {} }
  for (const [k, v] of Object.entries(settings)) data.settings[k] = toIni(v)
  repos.forEach((r, i) => {
    data[`repo.${i + 1}`] = { name: r.name, path: r.path, kind: r.kind ?? 'local' }
    // 원격(WebDAV) — 주소와 사용자 이름만. 비밀번호는 여기 쓰지 않는다 (Windows 자격 증명 관리자)
    if (r.remote) Object.assign(data[`repo.${i + 1}`], { remote: r.remote, user: r.user ?? '' })
    // 트리 펼침 — 접어 둔 저장소와 펼쳐 둔 폴더(저장소 기준 경로). 경로에 못 쓰는 `|` 로 잇는다
    if (r.open === false) data[`repo.${i + 1}`].open = 'false'
    if (r.expanded?.length) data[`repo.${i + 1}`].expanded = r.expanded.join('|')
  })
  if (recent?.length) {
    data.recent = {}
    // 번호는 글자로 정렬되므로(BTreeMap) 자리를 채워 10 이 2 보다 뒤에 오게 한다
    recent.forEach((p, i) => { data.recent[String(i + 1).padStart(3, '0')] = p })
  }
  return data
}

/** INI 구획 → { settings, repos, recent } */
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
      ...(data[s].remote ? { remote: data[s].remote, user: data[s].user || '' } : {}),
      open: data[s].open !== 'false',
      expanded: (data[s].expanded || '').split('|').filter(Boolean),
    }))
    .filter((r) => r.path)
  const recent = Object.entries(data.recent ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, p]) => p)
    .filter(Boolean)
  return { settings, repos, recent }
}

/* ---------- 읽기 ---------- */

const readLocal = (defaults) => ({
  settings: { ...defaults, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') },
  repos: JSON.parse(localStorage.getItem(LS_REPOS) || '[]'),
  recent: JSON.parse(localStorage.getItem(LS_RECENT) || '[]'),
})

/**
 * @returns {{ settings, repos, recent, path: string, note: string }}
 *          note 는 화면에 한 줄 알릴 말 (없으면 빈 글자)
 */
export async function loadConfig(defaults) {
  const empty = { settings: { ...defaults }, repos: [], recent: [] }
  if (!isTauri) {
    try { return { ...readLocal(defaults), path: '(브라우저)', note: '' } } catch { /* 아래 */ }
    return { ...empty, path: '(브라우저)', note: '' }
  }

  const path = await invoke('config_path').catch(() => 'MDTiptap.ini')
  let data
  try {
    data = await invoke('config_load')
  } catch (e) {
    return { ...empty, path, note: String(e) }
  }

  // 파일이 아직 없다 — 쓰던 것이 localStorage 에 있으면 그것을 옮겨 담는다
  if (Object.keys(data).length === 0) {
    let old = empty
    try { old = readLocal(defaults) } catch { /* 없으면 기본값 */ }
    const moved = old.repos.length > 0
    // 파일이 없을 때 한 번 — 합칠 것이 없으니 통째로 쓴다
    await invoke('config_save', { data: pack(old.settings, old.repos, old.recent) }).catch(() => {})
    remember(old.settings, old.recent)
    return { ...old, path, note: moved ? `설정을 ${path} 로 옮겼습니다` : '' }
  }

  const out = unpack(data, defaults)
  remember(out.settings, out.recent)
  return { ...out, path, note: '' }
}

/*
 * 여러 창이 같은 파일을 쓴다 — 단순 모드는 창마다 따로 뜬다(lib.rs). 그래서 통째로 덮지 않고
 * **쓰기 직전에 파일을 다시 읽어 이 창이 바꾼 것만 얹는다.** 오래 열어 둔 창이 처음 읽은 옛 값(저장소 목록 ·
 * 패널 폭)으로 다른 창의 변경을 되돌리지 않게.
 *   - 설정: 이 창이 읽은 뒤 바꾼 키만
 *   - 저장소 목록: 저장소를 쓰는 창(전체 모드)만 쓴다. 단순 모드는 파일의 것을 그대로 둔다
 *   - 최근 문서: 이 창의 목록 + 다른 창이 그새 더한 것 (이 창에서 뺀 것은 빠진 채로)
 */
let base = { settings: {}, recent: [] }
let ownsRepos = false
const remember = (settings, recent) => {
  base = { settings: Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, toIni(v)])), recent: [...recent] }
}
/** 이 창이 저장소 목록의 주인인가 (전체 모드). App 이 모드를 안 뒤에 알려 준다 */
export const setOwnsRepos = (v) => { ownsRepos = !!v }

function merge(disk, settings, repos, recent) {
  const mine = pack(settings, repos, recent)
  const out = { ...disk, settings: { ...(disk.settings ?? {}) } }
  for (const [k, v] of Object.entries(mine.settings)) {
    if (base.settings[k] !== v) out.settings[k] = v
  }
  if (ownsRepos) {
    for (const k of Object.keys(out)) if (k.startsWith('repo.')) delete out[k]
    for (const [k, v] of Object.entries(mine)) if (k.startsWith('repo.')) out[k] = v
  }
  const diskRecent = Object.entries(disk.recent ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, p]) => p)
  const added = diskRecent.filter((p) => !base.recent.includes(p) && !recent.includes(p))
  const all = [...recent, ...added].slice(0, 30)
  delete out.recent
  if (all.length) out.recent = Object.fromEntries(all.map((p, i) => [String(i + 1).padStart(3, '0'), p]))
  return out
}

/* ---------- 쓰기 ---------- */

export async function saveConfigNow(settings, repos, recent = []) {
  if (!isTauri) {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
      localStorage.setItem(LS_REPOS, JSON.stringify(repos))
      localStorage.setItem(LS_RECENT, JSON.stringify(recent))
    } catch { /* 무시 */ }
    return
  }
  const disk = await invoke('config_load').catch(() => ({}))
  await invoke('config_save', { data: merge(disk, settings, repos, recent) })
  remember(settings, recent)
}

let timer = 0
let pending = null
let onError = null

/** 실패를 알리고 싶으면 한 번 걸어 둔다 */
export const onConfigError = (fn) => { onError = fn }

/** 모아서 쓴다. 같은 순간에 여러 번 불러도 파일은 한 번만 쓰인다 */
export function saveConfig(settings, repos, recent = []) {
  pending = { settings, repos, recent }
  clearTimeout(timer)
  timer = setTimeout(flushConfig, SAVE_MS)
}

export function flushConfig() {
  clearTimeout(timer)
  if (!pending) return Promise.resolve()
  const { settings, repos, recent } = pending
  pending = null
  return saveConfigNow(settings, repos, recent).catch((e) => onError?.(String(e)))
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushConfig)
