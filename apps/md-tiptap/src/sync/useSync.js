import { useCallback, useEffect, useRef, useState } from 'react'
import { syncRepo, markDeleted, fetchAsset } from '@md/sync-core'
import { isTauri, note } from '../core.js'
import { storeFor, tauriFs, relOf } from './adapter.js'

/*
 * 저장소별 동기화 — 언제 · 무엇을 맞출지.
 *
 *   - 앱이 뜨면 한 번 — **전체 점검**(full): 바뀌지 않았다고 적힌 문서도 내용으로 견주고 그림이 원격에
 *     있는지 본다. 원격 목록(catalog)을 받아 트리에 ☁ 를 그린다
 *   - 동기화 단추 — 이것도 전체 점검
 *   - 정해 둔 간격마다 (설정 `syncSec`, 0 이면 끔)
 *   - 문서를 저장하면 그 문서만 (`only`) — 2초 모아서
 *   - ☁ 문서를 열 때 그 문서만 받는다 (`fetch`)
 *
 * 한 저장소의 동기화는 한 번에 하나만 돈다 (`chain`). 겹치면 기록 파일을 서로 덮는다.
 */

export const DEFAULT_SYNC_SEC = 30
/** 창으로 돌아올 때 맞추되, 이보다 자주는 하지 않는다 (창을 왔다 갔다 할 때마다 돌지 않게) */
const FOCUS_GAP_MS = 10_000

const newDeviceId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export default function useSync({ repos, settings, update, ready, beforeSync, afterSync }) {
  const [state, setState] = useState({})     // repoId → { busy, at, msg, error, catalog }
  const chains = useRef(new Map())           // repoId → 진행 중인 promise
  const cb = useRef({})
  cb.current = { beforeSync, afterSync, settings }

  // 이 기기의 ID — 한 번 만들어 설정에 둔다. 원격에서 "내 폴더" 의 이름이다
  useEffect(() => {
    if (ready && !settings.deviceId) update({ deviceId: newDeviceId() })
  }, [ready, settings.deviceId, update])

  const patch = (id, p) => setState((s) => ({ ...s, [id]: { ...(s[id] ?? {}), ...p } }))

  const run = useCallback((repo, opts = {}) => {
    if (!repo?.remote || !isTauri) return Promise.resolve(null)
    const s = cb.current.settings
    if (!s.deviceId) return Promise.resolve(null)
    const prev = chains.current.get(repo.id) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(async () => {
      patch(repo.id, { busy: true, error: null, msg: opts.want?.length ? '받는 중…' : opts.full ? '전체 점검 중…' : '맞추는 중…' })
      try {
        await cb.current.beforeSync?.(repo)
        const deviceName = s.deviceName || `PC-${s.deviceId.slice(-4)}`
        const r = await syncRepo({
          root: repo.path, store: storeFor(repo), fs: tauriFs,
          device: s.deviceId, deviceName, author: s.authorName || deviceName,
          want: opts.want ?? [], only: opts.only ?? null, full: !!opts.full,
          progress: (m) => patch(repo.id, { msg: m }),
        })
        const bits = []
        if (r.pulled) bits.push(`↓${r.pulled}`)
        if (r.pushed) bits.push(`↑${r.pushed}`)
        if (r.conflicts) bits.push(`충돌 ${r.conflicts}`)
        patch(repo.id, { busy: false, at: Date.now(), catalog: r.catalog, msg: bits.join(' ') || '맞음' })
        await cb.current.afterSync?.(repo, r)
        return r
      } catch (e) {
        const msg = String(e?.message ?? e)
        note(`동기화 실패 ${repo.name}: ${msg}`)
        patch(repo.id, { busy: false, error: msg, msg: '' })
        throw e
      }
    })
    chains.current.set(repo.id, next)
    return next
  }, [])

  /** ☁ 문서를 연다 — 그 문서만 받는다 */
  const fetch = useCallback(async (repo, abs) => {
    const rel = relOf(repo, abs)
    if (rel) await run(repo, { want: [rel] })
  }, [run])

  /**
   * 그림을 그려야 하는데 캐시에 없다 — 원격에서 받는다. 동기화와 같은 줄에서 돌린다
   * (같은 기록 파일을 쓴다). 같은 그림을 여러 번 부르면 한 번만 받는다
   */
  const assetJobs = useRef(new Map())
  const fetchImage = useCallback((repo, abs) => {
    const rel = relOf(repo, abs)
    if (!repo?.remote || !rel) return Promise.resolve(false)
    const key = `${repo.id}:${rel}`
    if (assetJobs.current.has(key)) return assetJobs.current.get(key)
    const prev = chains.current.get(repo.id) ?? Promise.resolve()
    const job = prev.catch(() => {}).then(() => fetchAsset({ root: repo.path, store: storeFor(repo), fs: tauriFs }, rel))
      .catch((e) => { note(`그림 받기 실패 ${rel}: ${e?.message ?? e}`); return false })
      .finally(() => assetJobs.current.delete(key))
    chains.current.set(repo.id, job)
    assetJobs.current.set(key, job)
    return job
  }, [])

  /** 저장 직후 — 그 문서만, 2초 모아서 */
  const timers = useRef(new Map())
  const pending = useRef(new Map())
  const saved = useCallback((repo, abs) => {
    const rel = relOf(repo, abs)
    if (!repo?.remote || !rel) return
    const set = pending.current.get(repo.id) ?? new Set()
    set.add(rel)
    pending.current.set(repo.id, set)
    clearTimeout(timers.current.get(repo.id))
    timers.current.set(repo.id, setTimeout(() => {
      const only = [...(pending.current.get(repo.id) ?? [])]
      pending.current.delete(repo.id)
      run(repo, { only }).catch(() => {})
    }, 2000))
  }, [run])

  /**
   * 트리에서 지웠다 — 원격에서도 지우도록 적어 둔다. 폴더면 그 아래 문서 전부
   * (받지 않은 ☁ 문서도 — 원격 목록에서 찾는다)
   */
  const removed = useCallback(async (repo, abs, { cachedOnly = false } = {}) => {
    const rel = relOf(repo, abs)
    if (!repo?.remote || !rel) return
    const catalog = state[repo.id]?.catalog ?? []
    // 옮긴 것(cachedOnly)이면 받아 둔 것만 옛 자리에서 지운다 — 받지 않은 ☁ 문서는 로컬에 없어
    // 함께 옮겨지지 않았으니 원격에서 지우면 사라진다
    const under = catalog
      .filter((c) => (c.path === rel || c.path.toLowerCase().startsWith(rel.toLowerCase() + '/')) && (!cachedOnly || c.cached))
      .map((c) => c.path)
    const rels = under.length ? under : [rel]
    await markDeleted({ root: repo.path, fs: tauriFs }, rels)
    saved(repo, abs)   // 곧 맞춘다
  }, [state, saved])

  // 뜰 때 한 번(전체 점검) + 간격마다
  const reposRef = useRef(repos)
  reposRef.current = repos
  /** 원격이 붙은 저장소 전부. full 이면 전체 점검 */
  const syncAll = useCallback((full = false) =>
    Promise.allSettled(reposRef.current.filter((r) => r.remote).map((r) => run(r, { full }))), [run])
  useEffect(() => {
    if (!ready || !settings.deviceId) return
    const all = () => { syncAll() }
    syncAll(true)
    // 창으로 돌아오면(PC 는 창 전환, 폰은 앱을 다시 앞으로) 바로 맞춘다 — 간격을 기다리지 않게
    let lastFocus = Date.now()
    const onBack = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFocus < FOCUS_GAP_MS) return
      lastFocus = Date.now()
      all()
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    const sec = Number(settings.syncSec ?? DEFAULT_SYNC_SEC)
    const t = sec > 0 ? setInterval(all, sec * 1000) : 0
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [ready, settings.deviceId, settings.syncSec, syncAll])

  /** 받아 둔 문서를 열었다 — 그 문서만 바로 맞춘다 (다른 기기에서 고친 것이 열자마자 보이게) */
  const opened = useCallback((repo, abs) => {
    const rel = relOf(repo, abs)
    if (repo?.remote && rel) run(repo, { only: [rel] }).catch(() => {})
  }, [run])

  return { state, run, syncAll, fetch, saved, removed, opened, fetchImage }
}
