import { hash, toChunks, joinBlocks, assignIds, prevSets } from './blocks.js'
import { merge3, firstContact } from './merge.js'

/*
 * 저장소 하나를 원격과 맞춘다 — git 의 pull + push 를 한 번에.
 *
 * ## 로컬은 "캐시" 다
 *
 * 원격을 등록할 때 로컬 캐시 폴더를 함께 정한다. **원격의 문서를 한꺼번에 내려받지 않는다.**
 *   - 트리는 원격의 문서 목록(`catalog`)으로 그린다 — 받지 않은 것은 ☁
 *   - 문서를 열 때 그 문서만 받는다 (`want`)
 *   - 맞출 때 오가는 것은 **캐시에 있는 문서**뿐이다
 *   - 캐시 폴더에서 파일이 없어졌다고 지운 것이 아니다 — **트리에서 지운 것만** 원격에서도
 *     지운다 (`markDeleted`). 그냥 없어진 것은 "받지 않은 것" 으로 돌아간다
 *
 * ## 원격의 모양 (저장소 — `store`)
 *
 *   <원격>/폴더/a.md                            평범한 마크다운 거울. 사람이 웹에서 그대로 읽는다
 *   <원격>/.mdsync/devices/<기기>/index.json      { name, at, docs: { 키: { rev, path, deleted? } } }
 *   <원격>/.mdsync/devices/<기기>/docs/<키>.json   { path, rev, seen, blocks: [[id, hash, 원문]] }
 *
 * **기기는 자기 이름의 폴더에만 쓴다.** 여럿이 같은 파일을 고쳐 쓰는 일이 없으니 서버에
 * 조건부 쓰기(If-Match)나 잠금이 없어도 서로 덮어쓰지 않는다 (Koofr 같은 서버도 된다).
 * 거울 `.md` 는 여러 기기가 쓰지만 사람이 보라고 두는 사본일 뿐, 동기화는 읽지 않는다.
 *
 * `store` 는 다섯 가지만 하면 된다 — WebDAV(remote.js)든 나중의 FTP 든:
 *   get(path) → string | null · put(path, text, type) · del(path) · list(dir) → [{ name, isDir }] · mkdirs(dir)
 *
 * ## 로컬의 기록 (`<캐시>/.mdsync/`, git 에는 들어가지 않는다)
 *
 *   repo.json        { files: { 경로: { size, mtime, seen } }, del: { 키: 경로 } }
 *   docs/<키>.json   { path, cur, pubRev, pubSig, pubHist, from: { 기기: { rev, list } } }
 *
 * ## 파일 시스템 (fs) — 앱에서는 Rust 커맨드, 시험에서는 메모리
 *
 *   list(root) → [{ rel, size, mtime }] · stat(abs) → { size, mtime } | null
 *   read(abs) → string | null · write(abs, text) · remove(abs)
 */

const STATE = '.mdsync'
/**
 * 원격 뿌리의 도장 파일 하나 — 어느 기기든 무엇을 올리면 새 값(아무 글자)으로 바꿔 쓴다.
 * 보통 맞추기는 이것만 읽어 지난번에 본 값과 같고 로컬도 그대로면 거기서 끝난다 (요청 한 번).
 * 기기 목록 · 기기마다 index.json 을 매번 받지 않는다
 */
const STAMP = '.mdsync-stamp'
/** 도장이 그대로여도 이만큼 지나면 한 번은 제대로 본다 — 두 기기가 같은 순간에 도장을 써서 하나가 묻힌 경우 */
const SLOW_EVERY_MS = 10 * 60_000
const newStamp = (device) => `${device}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * 지난번 이후 로컬에 바뀐 것이 있나 — 파일 목록(크기·시각)만 견준다. 디스크만 보므로 빠르다
 */
async function localChanged(fs, root, repoState) {
  if (Object.keys(repoState.del).length) return true
  const list = await fs.list(root)
  const known = new Set()
  for (const f of list) {
    const seen = repoState.files[f.rel]
    if (!seen || seen.size !== f.size || seen.mtime !== f.mtime) return true
    known.add(f.rel)
  }
  // 캐시에서 없어진 것 — 맞출 때 기록을 정리해야 한다
  if (Object.keys(repoState.files).some((p) => !known.has(p))) return true
  if (fs.listAssets) {
    for (const a of await fs.listAssets(root)) {
      const p = repoState.assets[a.rel]
      if (!p || p.size !== a.size || p.mtime !== a.mtime) return true
    }
  }
  return false
}
export const docKey = (rel) => hash(rel.normalize('NFC').replace(/\\/g, '/').toLowerCase())
const sig = (list) => (list ? list.map((b) => `${b.id}:${b.hash}`).join(',') : 'deleted')
const sameContent = (a, b) => !!a && !!b && a.map((x) => x.hash).join() === b.map((x) => x.hash).join()
const toRemote = (list) => list.map((b) => [b.id, b.hash, b.text])
const fromRemote = (blocks) => blocks.map(([id, h, text]) => ({ id, hash: h, text }))
const emptyState = () => ({ from: {}, cur: null, pubRev: 0, pubSig: null, path: null, pubHist: {} })
/** 내가 올린 판을 몇 개까지 기억할까 — 다른 기기가 "내 몇 번 판까지 합쳤다" 고 할 때 base 로 쓴다 */
const KEEP_PUB = 8

async function readJson(fs, abs) {
  const t = await fs.read(abs)
  if (t == null) return null
  try { return JSON.parse(t) } catch { return null }
}

/** 몇 개씩 나란히 — 요청 하나가 수백 ms 라 하나씩 하면 처음 올릴 때 너무 오래 걸린다 */
/** 연결이 끊긴 것(서버의 4xx·5xx 가 아닌)은 잠깐 쉬고 다시 — 큰 올리기 도중에 흔하다 */
async function retry(fn, waits = [2000, 6000]) {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= waits.length || !/연결 실패/.test(String(e?.message ?? e))) throw e
      await new Promise((r) => setTimeout(r, waits[i]))
    }
  }
}

async function pool(items, n, fn) {
  let i = 0
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run))
}

const loadRepoState = async (fs, root) => {
  const s = (await readJson(fs, `${root}/${STATE}/repo.json`)) ?? {}
  return { files: s.files ?? {}, del: s.del ?? {}, assets: s.assets ?? {}, stamp: s.stamp ?? null, slowAt: s.slowAt ?? 0, catalog: s.catalog ?? null }
}

/**
 * 트리에서 지웠다 — 다음 맞출 때 원격에서도 지운다. 파일을 지우기 **전에** 부른다.
 * 폴더를 지웠으면 그 아래 경로들을 다 넘긴다 (받지 않은 ☁ 문서도 포함 — catalog 에서).
 */
export async function markDeleted({ root, fs }, rels) {
  const rs = await loadRepoState(fs, root)
  for (const rel of rels) rs.del[docKey(rel)] = rel
  if ((await fs.read(`${root}/${STATE}/.gitignore`)) == null) await fs.write(`${root}/${STATE}/.gitignore`, '*\n')
  await fs.write(`${root}/${STATE}/repo.json`, JSON.stringify(rs))
}

/**
 * @param opts.root       로컬 캐시 폴더 (절대 경로)
 * @param opts.store      원격 저장소 (davClient — 나중에 FTP). 예전 이름 `dav` 도 받는다
 * @param opts.fs         위의 파일 시스템
 * @param opts.device     이 기기의 ID · opts.deviceName 사람이 읽을 이름 (충돌 블록에 나온다)
 * @param opts.want       지금 받아야 할 문서들의 경로 (열려는 것). 캐시에 없으면 받아 온다
 * @param opts.only       이 경로들만 맞춘다 (저장 직후처럼 가볍게). 없으면 캐시 전체
 * @param opts.full       전체 점검 — 바뀌지 않았다고 적힌 문서도 내용으로 견주고, 그림이 원격에 있는지 본다
 * @returns {{ pulled, pushed, created, deleted, conflicts, changedPaths, catalog }}
 *          catalog = [{ path, cached }] — 원격에 살아 있는 문서 전부 (트리가 ☁ 를 그린다)
 */
export async function syncRepo({ root, store, dav, fs, device, deviceName = device, author = deviceName, want = [], only = null, full = false, progress = () => {}, concurrency = 4 }) {
  store = store ?? dav
  const ctx = { root, store, fs, me: device, deviceName, author, abs: (rel) => `${root}/${rel}`, mine: `.mdsync/devices/${device}` }
  const stat = { pulled: 0, pushed: 0, created: 0, deleted: 0, conflicts: 0, changedPaths: [], catalog: [], assetsUp: 0, failed: [] }

  // git 이 이 폴더를 커밋하지 않게 — 폴더 스스로를 무시시키는 .gitignore
  if ((await fs.read(ctx.abs(`${STATE}/.gitignore`))) == null) await fs.write(ctx.abs(`${STATE}/.gitignore`), '*\n')
  const repoState = await loadRepoState(fs, root)

  // 빠른 길 — 원격 도장이 지난번 그대로고 로컬도 그대로면 볼 것이 없다.
  // 전체 점검 · 문서 받기(want) 는 늘 제대로 본다
  progress('원격 확인')
  const stampAtStart = await store.get(STAMP).catch(() => null)
  if (!full && !want.length && stampAtStart != null && stampAtStart === repoState.stamp && repoState.catalog
      && Date.now() - repoState.slowAt < SLOW_EVERY_MS && !(await localChanged(fs, root, repoState))) {
    const cached = new Set(Object.keys(repoState.files).map(docKey))
    stat.catalog = repoState.catalog.map((c) => ({ path: c.path, cached: cached.has(docKey(c.path)) }))
    stat.fast = true
    progress('끝')
    return stat
  }

  await store.mkdirs(`${ctx.mine}/docs`)
  const others = (await store.list('.mdsync/devices')).filter((e) => e.isDir && e.name !== device).map((e) => e.name)
  const indexes = {}
  await pool(others, concurrency, async (d) => {
    const t = await store.get(`.mdsync/devices/${d}/index.json`)
    if (t) { try { indexes[d] = JSON.parse(t) } catch { /* 쓰는 중이던 것 — 다음 번에 */ } }
  })
  const myIndex = JSON.parse((await store.get(`${ctx.mine}/index.json`)) ?? 'null') ?? { docs: {} }

  progress('캐시 확인')
  const local = new Map((await fs.list(root)).map((f) => [docKey(f.rel), f]))
  const wanted = new Set(want.map(docKey))
  const onlySet = only ? new Set(only.map(docKey)) : null
  // 맞출 문서: 캐시에 있는 것 · 받으려는 것 · 트리에서 지운 것
  const keys = new Set([...local.keys(), ...wanted, ...Object.keys(repoState.del)])
  // 캐시에서 없어진 것(트리에서 지운 것이 아닌) — 지운 게 아니라 "받지 않은 것" 으로 돌아간다
  for (const [p] of Object.entries(repoState.files)) {
    const k = docKey(p)
    if (!local.has(k) && !wanted.has(k) && !repoState.del[k]) delete repoState.files[p]
  }

  let indexChanged = false
  const work = [...keys].filter((k) => !onlySet || onlySet.has(k) || wanted.has(k))
  let done = 0
  await pool(work, concurrency, async (key) => {
    const f = local.get(key)
    const seen = f ? repoState.files[f.rel] : null
    const remote = Object.entries(indexes).filter(([, idx]) => idx.docs?.[key])
    const fileSame = seen && seen.size === f.size && seen.mtime === f.mtime
    const remoteSame = remote.every(([d, idx]) => idx.docs[key].rev <= (seen?.seen?.[d] ?? -1))
    // 파일도 그대로고 원격 판도 그대로면 볼 것이 없다 (노트 수백 개를 매번 읽지 않게).
    // 전체 점검(full)은 이 지름길을 믿지 않고 하나하나 내용으로 견준다
    if (fileSame && remoteSame && !full) { done++; return }

    // 문서 하나가 실패해도 나머지는 맞춘다 — 기록하지 않았으니 다음 번에 다시 본다
    let r
    try { r = await syncDoc(ctx, key, f, remote, indexes, myIndex, !!repoState.del[key], stat) } catch (e) {
      stat.failed.push(`${f?.rel ?? key}: ${e?.message ?? e}`)
      return
    }
    if (r.published) {
      myIndex.docs[key] = r.published
      indexChanged = true
    }
    if (repoState.del[key] && (r.published || !r.exists)) delete repoState.del[key]
    if (f && f.rel !== r.path) delete repoState.files[f.rel]
    if (r.exists) {
      const now = await fs.stat(ctx.abs(r.path))
      if (now) repoState.files[r.path] = { size: now.size, mtime: now.mtime, seen: r.seen }
    } else if (r.path) delete repoState.files[r.path]
    if (++done % 25 === 0) progress(`문서 ${done}/${work.length}`)
  })

  let published = false
  // 문서까지 맞춘 것을 먼저 남긴다. 그림 올리기는 길다(저장소 하나에 수백 MB) — 도중에 끊기거나
  // 앱을 닫아도 문서 쪽은 처음부터 다시 하지 않게. 예전에는 끝에서만 남겨서, 그림 하나가 실패하면
  // 매번 문서 수백 개를 새 판으로 다시 올렸다
  const checkpoint = async () => {
    if (indexChanged) {
      myIndex.name = deviceName
      myIndex.at = new Date().toISOString()
      await store.put(`${ctx.mine}/index.json`, JSON.stringify(myIndex), 'application/json')
      indexChanged = false
      published = true
    }
    await fs.write(ctx.abs(`${STATE}/repo.json`), JSON.stringify(repoState))
  }
  await checkpoint()

  // 그림 — 새로 생긴(또는 바뀐) 것만 원격의 같은 자리에 올린다. 받는 것은 볼 때 (fetchAsset)
  // 저장 직후의 가벼운 동기화(only)에서도 한다 — 그림을 붙이고 저장했는데 그림만 다음 간격까지
  // 기다리면 다른 기기에서는 글만 오고 그림은 빈 칸이다 (목록 걷기는 Rust 라 빠르다)
  if (fs.listAssets) {
    progress('그림 확인')
    const assets = await fs.listAssets(root)
    let todo = assets.filter((a) => {
      const p = repoState.assets[a.rel]
      return !p || p.size !== a.size || p.mtime !== a.mtime
    })
    // 전체 점검 — 올렸다고 적어 둔 그림도 원격에 정말 있는지 본다 (원격에서 누가 지웠거나 올리다 끊긴 것)
    if (full) {
      const fresh = new Set(todo.map((a) => a.rel))
      const known = assets.filter((a) => !fresh.has(a.rel))
      // 그림 하나마다 묻지 않고 폴더마다 목록 한 번 (그림 폴더는 문서 폴더마다 하나라 몇 개 안 된다)
      const dirOf = (rel) => rel.split('/').slice(0, -1).join('/')
      const there = new Map()
      await pool([...new Set(known.map((a) => dirOf(a.rel)))], concurrency, async (dir) => {
        there.set(dir, new Set((await store.list(dir)).filter((e) => !e.isDir).map((e) => e.name)))
      })
      todo = todo.concat(known.filter((a) => !there.get(dirOf(a.rel))?.has(a.rel.split('/').pop())))
    }
    // 그림은 둘씩만 — 여럿을 한꺼번에 올리면 Koofr 가 연결을 끊었다 (os error 10053).
    // 하나가 실패해도 나머지는 올리고, 실패한 것은 적지 않았으니 다음 번에 그것만 다시 올린다
    let n = 0
    await pool(todo, Math.min(2, concurrency), async (a) => {
      progress(`그림 ${++n}/${todo.length}`)
      try {
        const b64 = await fs.readB64(ctx.abs(a.rel))
        await retry(() => store.putBinary(a.rel, b64, mimeOf(a.rel)))
        repoState.assets[a.rel] = { size: a.size, mtime: a.mtime }
        stat.assetsUp++
        // 중간중간 남긴다 — 수백 개를 올리다 앱을 닫아도 올린 것은 다시 올리지 않게
        if (stat.assetsUp % 20 === 0) await fs.write(ctx.abs(`${STATE}/repo.json`), JSON.stringify(repoState))
      } catch (e) {
        stat.failed.push(`${a.rel}: ${e?.message ?? e}`)
      }
    })
  }

  // 무엇을 올렸으면(문서 판 · 그림) 도장을 새로 쓴다 — 다른 기기가 "바뀌었다" 를 요청 한 번으로 안다.
  // index 를 올린 **뒤에** 쓴다: 도장이 바뀐 것을 보고 왔는데 index 가 아직이면 안 된다.
  // 쓰기 직전에 다시 읽어 그새 남이 썼으면 내 것을 "본 것" 으로 적지 않는다 — 남의 고침을 못 보고 넘어가지 않게
  let seenStamp = stampAtStart
  // 도장이 아직 없으면(처음 붙인 원격) 지금 만든다 — 그래야 다음부터 빠른 길을 탄다
  if (published || stat.assetsUp || stampAtStart == null) {
    const now = await store.get(STAMP).catch(() => null)
    const mineStamp = newStamp(device)
    await store.put(STAMP, mineStamp, 'text/plain; charset=utf-8')
    seenStamp = now === stampAtStart ? mineStamp : null
  }
  stat.catalog = catalogOf([myIndex, ...Object.values(indexes)], repoState)
  // 실패한 것이 있거나, 저장한 문서만 본 것(only)이면 "다 봤다" 고 적지 않는다 — 다음에 제대로 본다
  repoState.stamp = stat.failed.length || onlySet ? null : seenStamp
  repoState.slowAt = Date.now()
  repoState.catalog = stat.catalog.map((c) => ({ path: c.path }))
  await checkpoint()
  progress('끝')
  return stat
}

/**
 * 원격에 살아 있는 문서 목록. 어느 기기든 마지막 판이 "지움" 이 아니면 살아 있다
 * (지우는 사이 다른 기기가 고쳤으면 고친 것이 산다 — 병합 규칙과 같다).
 */
function catalogOf(indexes, repoState) {
  const alive = new Map()
  const dead = new Map()
  for (const idx of indexes) {
    for (const [key, e] of Object.entries(idx.docs ?? {})) {
      if (e.deleted) dead.set(key, e.path)
      else alive.set(key, e.path)
    }
  }
  const cached = new Set(Object.keys(repoState.files).map(docKey))
  return [...alive].filter(([key]) => !repoState.del[key]).map(([key, path]) => ({ path, cached: cached.has(key) }))
}

/**
 * 그 기기 판과 내 판의 **공통 조상** — 병합의 base.
 *
 * 후보가 둘이다.
 *   ① 그 기기 판 중 내가 마지막으로 합친 것 (`st.from[d]`)
 *   ② 내 판 중 그 기기가 마지막으로 합친 것 (`head.seen[나]` 번 — 내가 기억해 둔 `pubHist`)
 * 둘 다 양쪽의 조상이다. 더 나중 것을 쓴다: ② 를 올릴 때 이미 ① 을 합쳐 두었으면 ② 가 더 새롭다.
 * ② 를 빼먹으면 "상대가 이미 받아 간 내 고침" 을 상대가 새로 쓴 것으로 오해해 옛 블록이
 * 되살아나거나 충돌 블록이 불어난다 (시험으로 확인했다).
 */
function baseFor(st, d, head, me) {
  const viewed = st.from[d] ?? null
  const j = head.seen?.[me]
  const mineThen = j != null ? st.pubHist?.[j] : null
  if (mineThen && (!viewed || (mineThen.seen?.[d] ?? 0) >= viewed.rev)) return mineThen.list
  return viewed?.list ?? null
}

/** 문서 한 개를 맞춘다 */
/**
 * 지난 판에서 무엇이 바뀌었나 — 블록 단위 (더함 · 지움 · 고침). 이력에 함께 적는다
 */
export function summarize(before, after) {
  const b = new Map((before ?? []).map((x) => [x.id, x.hash]))
  const a = new Map((after ?? []).map((x) => [x.id, x.hash]))
  let added = 0
  let removed = 0
  let changed = 0
  for (const [id, h] of a) { if (!b.has(id)) added++; else if (b.get(id) !== h) changed++ }
  for (const id of b.keys()) if (!a.has(id)) removed++
  return { added, removed, changed }
}

async function syncDoc({ fs, store, abs, mine, me, deviceName, author }, key, f, remote, indexes, myIndex, delReq, stat) {
  const stPath = abs(`${STATE}/docs/${key}.json`)
  const st = (await readJson(fs, stPath)) ?? emptyState()
  const myEntry = myIndex.docs[key]
  // 캐시를 새로 만들었으면 기록이 없다 — 내가 전에 올린 판 번호에서 이어 간다 (1 로 돌아가면
  // 다른 기기가 "이미 본 판" 으로 여겨 무시한다)
  if (myEntry && myEntry.rev > st.pubRev) st.pubRev = myEntry.rev

  // 1) 내 지금 판
  const localText = f ? await fs.read(abs(f.rel)) : null
  // 캐시에 없으면(내보냈거나 처음 받는다) 지난번 맞춘 판에서 다시 짓는다 — 그 뒤의 원격 판은 아래서 합친다
  let cur = f ? assignIds(st.cur ?? [], toChunks(localText ?? '')) : st.cur
  let path = f?.rel ?? st.path ?? myEntry?.path ?? null

  // 캐시에 없고 기록도 없다(처음 받는다) — 내가 전에 올린 판이 있으면 그것부터
  if (!f && !st.cur && myEntry && !myEntry.deleted) {
    const head = JSON.parse((await store.get(`${mine}/docs/${key}.json`)) ?? 'null')
    if (head && !head.deleted) {
      cur = fromRemote(head.blocks)
      st.pubSig = sig(cur)
      st.pubHist = { [head.rev]: { list: cur, seen: head.seen ?? {} } }
      for (const [d, rev] of Object.entries(head.seen ?? {})) st.from[d] = { rev, list: null }
      path = head.path
    }
  }
  const lists = [cur]

  // 2) 다른 기기들의 판을 하나씩 합친다
  for (const [d, idx] of remote) {
    const entry = idx.docs[key]
    // 이미 합친 판이면 넘어간다 — 캐시를 새로 만들어 내 판에서 되살린 경우도 그 판은 이미 들어 있다
    if (entry.rev <= (st.from[d]?.rev ?? 0)) continue
    const head = JSON.parse((await store.get(`.mdsync/devices/${d}/docs/${key}.json`)) ?? 'null')
    if (!head) continue
    stat.pulled++
    const theirs = head.deleted ? null : fromRemote(head.blocks)
    const base = baseFor(st, d, head, me)
    const label = idx.name ?? d
    if (theirs) lists.push(theirs)

    if (!theirs) {
      // 그 기기가 지웠다 — 내가 그 뒤로 고친 것이 없으면 따라 지운다 (고친 것이 산다)
      if (cur && (base ? sameContent(cur, base) : !st.cur)) cur = null
    } else if (!cur) {
      cur = theirs
    } else {
      const start = base ? { base, local: cur } : firstContact(cur, theirs)
      const m = merge3(start.base, start.local, theirs, { label })
      cur = m.list
      stat.conflicts += m.conflicts
    }
    path = path ?? head.path
    st.from[d] = { rev: entry.rev, list: theirs }
  }

  // 트리에서 지웠다 — 원격에서 들어온 것까지 합친 뒤에 지운다 (그래야 그 판까지 본 것으로 남는다)
  if (delReq) cur = null

  // 3) 캐시에 반영
  const text = cur ? joinBlocks(cur, prevSets(...lists)) : null
  if (cur && text !== localText) {
    await fs.write(abs(path), text)
    stat.changedPaths.push(path)
    if (!f) stat.created++
  } else if (!cur && f) {
    await fs.remove(abs(f.rel))
    stat.deleted++
    stat.changedPaths.push(f.rel)
  }

  // 4) 내 판을 올린다 — 지난번 올린 것과 다를 때만
  let published = null
  const s = sig(cur)
  const seenRevs = Object.fromEntries(Object.entries(st.from).map(([d, v]) => [d, v.rev]))
  if (s !== st.pubSig && (cur || st.pubSig || myEntry)) {
    const rev = st.pubRev + 1
    // seen — "각 기기의 몇 번 판까지 합쳤나". 받는 쪽이 공통 조상을 고르는 데 쓴다 (baseFor)
    // 누가 · 언제 · 무엇을 (블록 단위로 몇 개) — 이력
    const who = { author, device: me, deviceName, at: new Date().toISOString(), summary: summarize(st.pubHist?.[st.pubRev]?.list ?? null, cur) }
    const head = cur
      ? { path, rev, seen: seenRevs, ...who, blocks: toRemote(cur) }
      : { path, rev, seen: seenRevs, ...who, deleted: true }
    const body = JSON.stringify(head)
    await store.put(`${mine}/docs/${key}.json`, body, 'application/json')
    // 이력은 **덮어쓰지 않는** 파일에 한 판씩 쌓는다. 실패해도 동기화는 됐다 — 다음 판부터 다시 쌓인다
    try { await store.put(`${mine}/hist/${key}/${rev}.json`, body, 'application/json') } catch { /* 이력 한 칸 빠짐 */ }
    // 사람이 보는 거울. 실패해도 동기화는 이미 됐다
    try {
      if (cur) await store.put(path, text, 'text/markdown; charset=utf-8')
      else await store.del(path)
    } catch { /* 다음 번에 다시 쓴다 */ }
    st.pubRev = rev
    st.pubSig = s
    st.pubHist = { ...(st.pubHist ?? {}), [rev]: { list: cur, seen: seenRevs } }
    for (const old of Object.keys(st.pubHist)) if (Number(old) <= rev - KEEP_PUB) delete st.pubHist[old]
    published = cur ? { rev, path } : { rev, path, deleted: true }
    stat.pushed++
  }

  st.cur = cur
  st.path = path
  await fs.write(stPath, JSON.stringify(st))
  return { path, exists: !!cur, published, seen: seenRevs }
}

/**
 * 문서 하나의 이력 — 모든 기기가 쌓은 판을 시각 순으로.
 * @returns [{ device, deviceName, author, at, rev, summary, deleted, text }]  (text = 그 판의 글)
 */
export async function docHistory({ store, concurrency = 4 }, path) {
  const key = docKey(path)
  const devices = (await store.list('.mdsync/devices')).filter((e) => e.isDir).map((e) => e.name)
  const out = []
  await pool(devices, concurrency, async (d) => {
    const revs = (await store.list(`.mdsync/devices/${d}/hist/${key}`)).filter((e) => !e.isDir)
    await pool(revs, concurrency, async (e) => {
      const h = JSON.parse((await store.get(`.mdsync/devices/${d}/hist/${key}/${e.name}`)) ?? 'null')
      if (!h) return
      out.push({
        device: h.device ?? d, deviceName: h.deviceName ?? d, author: h.author ?? h.deviceName ?? d,
        at: h.at, rev: h.rev, summary: h.summary, deleted: !!h.deleted, path: h.path,
        text: h.deleted ? '' : joinBlocks(fromRemote(h.blocks)),
      })
    })
  })
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon' }
const mimeOf = (rel) => MIME[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream'

/**
 * 그림 하나를 원격에서 받아 캐시에 둔다 — 문서를 열어 그 그림을 그려야 할 때 부른다.
 * 받은 것은 "이미 올라가 있는 것" 으로 적어 둔다 (다음 동기화가 도로 올리지 않게).
 * 앱에서는 동기화와 같은 줄(chain)에서 돌린다 — 기록 파일을 함께 쓰니까.
 * @returns 받았으면 true, 원격에도 없으면 false
 */
export async function fetchAsset({ root, store, fs }, rel) {
  const b64 = await store.getBinary(rel)
  if (b64 == null) return false
  const abs = `${root}/${rel}`
  await fs.writeB64(abs, b64)
  const rs = await loadRepoState(fs, root)
  const now = await fs.stat(abs)
  if (now) rs.assets[rel] = { size: now.size, mtime: now.mtime }
  await fs.write(`${root}/${STATE}/repo.json`, JSON.stringify(rs))
  return true
}
