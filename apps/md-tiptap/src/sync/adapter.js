import { invoke as rawInvoke } from '@tauri-apps/api/core'
import { invoke } from '../core.js'
import { davClient } from '@md/sync-core'

/*
 * 동기화 엔진(packages/sync-core)을 이 앱에 잇는다.
 *
 * - 파일: Rust 커맨드 (md-core). 쓰기는 `write_file` 이라 파일 감시가 "우리가 쓴 것" 으로 안다 —
 *   그래서 열려 있는 탭은 감시가 아니라 동기화 결과(changedPaths)로 다시 읽는다 (useSync.js)
 * - 원격: WebDAV 요청을 Rust 가 대신 보낸다 (CORS). 비밀번호는 Rust 가 자격 증명 관리자에서
 *   직접 꺼내므로 여기에는 없다. 원격 요청은 느린 게 정상이라 `.mdlog` 의 "느림" 기록에서 뺀다
 *   (rawInvoke)
 *
 * 나중에 FTP 를 붙이려면 storeFor 에서 kind 를 보고 같은 다섯 가지(get·put·del·list·mkdirs)를
 * 하는 클라이언트를 돌려주면 된다.
 */

export const tauriFs = {
  list: (root) => invoke('list_md', { root }),
  stat: (path) => invoke('stat_file', { path }),
  // 없는 것은 null — 기록 파일은 처음엔 없다. 있는데 못 읽는 것은 오류로 둔다
  read: async (path) => ((await invoke('stat_file', { path })) ? invoke('read_file', { path }) : null),
  write: (path, text) => invoke('write_file', { path, contents: text }),
  remove: (path) => invoke('delete_path', { path }),
  // 그림 — 저장소의 그림 목록 (`.image/` 포함) 과 base64 로 읽고 쓰기
  listAssets: (root) => invoke('list_assets', { root }),
  readB64: (path) => invoke('read_binary_base64', { path }),
  writeB64: (path, b64) => invoke('save_binary_b64', { path, b64 }),
}

/** 비밀번호를 찾는 열쇠 — `사용자@서버` */
export const accountOf = (remote, user) => {
  let host = remote
  try { host = new URL(remote).host } catch { /* 주소가 이상하면 그대로 */ }
  return `${user}@${host}`
}

/** 글자 수 → 대략의 바이트 (base64 는 3/4) */
const sizeOf = (s, b64) => (s ? (b64 ? Math.floor(s.length * 3 / 4) : new TextEncoder().encode(s).length) : 0)

/**
 * `meter` 를 주면 요청 수와 오간 바이트를 센다 — 동기화 한 번이 얼마나 주고받는지 (useSync 가 기록에 남긴다).
 * 머리글 · TLS 는 빠지므로 실제보다 조금 적다
 */
export function storeFor(repo, meter = null) {
  const account = accountOf(repo.remote, repo.user)
  const transport = async ({ method, url, headers = [], body, body_b64, binary }) => {
    const r = await rawInvoke('dav_request', {
      req: { method, url, account, user: repo.user, headers, body: body ?? null, body_b64: body_b64 ?? null, binary: !!binary },
    })
    if (meter) {
      meter.req++
      meter.up += sizeOf(body) + sizeOf(body_b64, true)
      meter.down += sizeOf(r?.body, binary)
    }
    return r
  }
  return davClient(repo.remote, transport)
}

export const setPassword = (repo, password) => invoke('cred_set', { account: accountOf(repo.remote, repo.user), password })
export const hasPassword = (repo) => invoke('cred_has', { account: accountOf(repo.remote, repo.user) })
export const forgetPassword = (repo) => invoke('cred_delete', { account: accountOf(repo.remote, repo.user) })

/** 저장소 안의 상대 경로 (`/` 로) — 저장소 밖이면 null */
export function relOf(repo, abs) {
  const a = abs.replace(/\\/g, '/')
  const r = repo.path.replace(/\\/g, '/').replace(/\/+$/, '')
  return a.toLowerCase().startsWith(r.toLowerCase() + '/') ? a.slice(r.length + 1) : null
}
