import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memFs, memDav } from './fakes.js'
import { syncRepo, markDeleted } from '../src/engine.js'

/*
 * 기기 여럿이 한 원격(메모리 WebDAV)을 두고 맞추는 시험.
 * 기기 = 자기 캐시 폴더(메모리 fs) + 기기 ID. 캐시는 열어 본 문서만 갖는다.
 */

export function world() {
  const server = memDav()
  const dev = (id, files = {}) => {
    const fs = memFs(Object.fromEntries(Object.entries(files).map(([k, v]) => [`/r/${k}`, v])))
    const sync = (opts = {}) => syncRepo({ root: '/r', store: server.client(), fs, device: id, deviceName: id, ...opts })
    /** 원격에 있는 문서를 전부 열어 본 것처럼 받는다 */
    const fetchAll = async () => { const r = await sync(); return sync({ want: r.catalog.map((c) => c.path) }) }
    const read = (rel) => fs.files.get(`/r/${rel}`)
    const edit = (rel, t) => fs.edit(`/r/${rel}`, t)
    /** 트리에서 지우기 — 원격에서도 지운다 */
    const remove = async (rel) => { await markDeleted({ root: '/r', fs }, [rel]); fs.files.delete(`/r/${rel}`) }
    /** 캐시에서만 없어짐 (탐색기에서 지움 등) — 원격은 그대로 */
    const evict = (rel) => fs.files.delete(`/r/${rel}`)
    return { id, fs, sync, fetchAll, read, edit, remove, evict }
  }
  return { server, dev }
}

const DOC = '# 회의\n\n첫 문단입니다.\n\n둘째 문단입니다.\n\n셋째 문단입니다.\n'

test('클론은 목록만 받는다 — 열 때 그 문서만', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC, '폴더/b.md': '# B\n', 'c.md': '# C\n' })
  await A.sync()
  const B = w.dev('B')
  const r = await B.sync()
  assert.equal(r.created, 0)
  assert.equal(B.fs.files.size, 2)   // .mdsync 의 기록 두 개뿐 — 문서는 하나도 받지 않았다
  assert.deepEqual(r.catalog.map((c) => [c.path, c.cached]).sort(), [['a.md', false], ['c.md', false], ['폴더/b.md', false]])
  const r2 = await B.sync({ want: ['폴더/b.md'] })
  assert.equal(r2.created, 1)
  assert.equal(B.read('폴더/b.md'), '# B\n')
  assert.equal(B.read('a.md'), undefined)
  assert.equal(r2.catalog.find((c) => c.path === '폴더/b.md').cached, true)
})

test('올리고 받으면 바이트까지 같다 (CRLF · BOM · 한글 경로 · 빈 파일)', async () => {
  const w = world()
  const files = { 'a.md': DOC, '폴더/한글 이름.md': '﻿# 제목\r\n\r\n윈도 줄바꿈\r\n', '빈.md': '' }
  const A = w.dev('A', files)
  const r1 = await A.sync()
  assert.equal(r1.pushed, 3)
  assert.equal(w.server.files.get('notes/a.md'), DOC)      // 사람이 읽는 거울
  const B = w.dev('B')
  await B.fetchAll()
  for (const [k, v] of Object.entries(files)) assert.equal(B.read(k), v, k)
})

test('다시 맞춰도 아무것도 오가지 않는다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll(); await A.sync(); await B.sync()
  const r = await A.sync()
  assert.deepEqual([r.pulled, r.pushed, r.conflicts, r.changedPaths.length], [0, 0, 0, 0])
  const r2 = await B.sync()
  assert.deepEqual([r2.pulled, r2.pushed, r2.conflicts], [0, 0, 0])
})

test('서로 다른 문단을 고치면 둘 다 들어간다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  A.edit('a.md', DOC.replace('첫 문단입니다.', '첫 문단 — A 가 고침.'))
  B.edit('a.md', DOC.replace('셋째 문단입니다.', '셋째 문단 — B 가 고침.'))
  await A.sync(); await B.sync(); await A.sync()
  const want = DOC.replace('첫 문단입니다.', '첫 문단 — A 가 고침.').replace('셋째 문단입니다.', '셋째 문단 — B 가 고침.')
  assert.equal(A.read('a.md'), want)
  assert.equal(B.read('a.md'), want)
})

test('양쪽에서 새 문단을 더해도 둘 다 제자리에', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  A.edit('a.md', DOC.replace('첫 문단입니다.\n', '첫 문단입니다.\n\nA 가 더한 문단.\n'))
  B.edit('a.md', DOC.replace('셋째 문단입니다.\n', '셋째 문단입니다.\n\nB 가 더한 문단.\n'))
  await A.sync(); await B.sync(); await A.sync()
  assert.equal(A.read('a.md'), B.read('a.md'))
  assert.match(A.read('a.md'), /첫 문단입니다\.\n\nA 가 더한 문단\.\n\n둘째/)
  assert.match(A.read('a.md'), /셋째 문단입니다\.\n\nB 가 더한 문단\.\n$/)
})

test('같은 문단의 다른 줄을 고치면 줄 단위로 합친다', async () => {
  const w = world()
  const base = '# 목록\n\n- 하나\n- 둘\n- 셋\n- 넷\n'
  const A = w.dev('A', { 'a.md': base })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  A.edit('a.md', base.replace('- 하나', '- 하나 (A)'))
  B.edit('a.md', base.replace('- 넷', '- 넷 (B)'))
  await A.sync(); await B.sync(); await A.sync()
  const want = base.replace('- 하나', '- 하나 (A)').replace('- 넷', '- 넷 (B)')
  assert.equal(A.read('a.md'), want)
  assert.equal(B.read('a.md'), want)
})

test('같은 문단을 둘 다 고치면 충돌 블록 — 양쪽이 같고, 더 맞춰도 불어나지 않는다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  A.edit('a.md', DOC.replace('둘째 문단입니다.', '둘째 — A 판.'))
  B.edit('a.md', DOC.replace('둘째 문단입니다.', '둘째 — B 판.'))
  const ra = await A.sync()
  const rb = await B.sync()
  await A.sync(); await B.sync(); await A.sync()
  assert.equal(ra.conflicts + rb.conflicts, 1)
  assert.equal(A.read('a.md'), B.read('a.md'))
  const text = A.read('a.md')
  assert.equal((text.match(/동기화 충돌/g) || []).length, 1)
  assert.ok(text.includes('A 판') && text.includes('B 판'))
  const again = await A.sync()
  assert.deepEqual([again.pushed, again.conflicts], [0, 0])
})

test('트리에서 지우면 다른 기기에서도 — 그 사이 고쳤으면 되살린다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC, 'b.md': '# B\n' })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  await A.remove('a.md')
  await A.sync()
  const rb = await B.sync()
  assert.equal(B.read('a.md'), undefined)
  assert.ok(!rb.catalog.some((c) => c.path === 'a.md'))
  // b.md: A 가 지우는 사이 B 가 고쳤다 → 고친 것이 산다
  await A.remove('b.md')
  B.edit('b.md', '# B\n\nB 가 고침\n')
  await A.sync(); await B.sync()
  const ra = await A.sync()
  assert.ok(ra.catalog.some((c) => c.path === 'b.md'), '되살아난 문서가 목록에 있다')
  await A.sync({ want: ['b.md'] })
  assert.equal(A.read('b.md'), '# B\n\nB 가 고침\n')
  assert.equal(B.read('b.md'), '# B\n\nB 가 고침\n')
})

test('캐시에서만 없어진 것은 지운 게 아니다 — ☁ 로 돌아가고 다시 받을 수 있다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  B.evict('a.md')
  const r = await B.sync()
  assert.equal(r.pushed, 0)
  assert.deepEqual(r.catalog.map((c) => [c.path, c.cached]), [['a.md', false]])
  const ra = await A.sync()
  assert.equal(A.read('a.md'), DOC)
  assert.equal(ra.deleted, 0)
  await B.sync({ want: ['a.md'] })
  assert.equal(B.read('a.md'), DOC)
})

test('캐시를 새로 만들어도(같은 기기) 내 판 번호가 이어진다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll()
  A.edit('a.md', DOC + '\nA 둘째 판.\n'); await A.sync()
  // A 의 캐시를 통째로 잃었다 — 같은 기기 ID 로 다시
  const A2 = w.dev('A')
  await A2.fetchAll()
  assert.equal(A2.read('a.md'), DOC + '\nA 둘째 판.\n')
  A2.edit('a.md', DOC + '\nA 셋째 판.\n')
  await A2.sync()
  await B.sync()
  assert.equal(B.read('a.md'), DOC + '\nA 셋째 판.\n')
})

test('같은 파일을 따로 가진 두 기기가 처음 만나도 겹치지 않는다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B', { 'a.md': DOC.replace('셋째 문단입니다.', '셋째 — B 만의 판.') })
  await A.sync(); await B.sync(); await A.sync()
  assert.equal(A.read('a.md'), B.read('a.md'))
  assert.equal((A.read('a.md').match(/첫 문단입니다/g) || []).length, 1)
})

test('only — 저장한 문서만 가볍게 올린다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC, 'b.md': '# B\n' })
  await A.sync()
  A.edit('a.md', DOC + '\n더함\n')
  A.edit('b.md', '# B 고침\n')
  const r = await A.sync({ only: ['a.md'] })
  assert.equal(r.pushed, 1)
  const r2 = await A.sync()
  assert.equal(r2.pushed, 1)   // b.md 는 다음 번에
})

test('이력 — 누가 · 언제 · 무엇을', async () => {
  const { docHistory } = await import('../src/engine.js')
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync({ author: '김철수' })
  await B.fetchAll()
  B.edit('a.md', DOC.replace('둘째 문단입니다.', '둘째 — B 가 고침.') + '\n새 문단.\n')
  await B.sync({ author: '이영희' })
  const h = await docHistory({ store: w.server.client() }, 'a.md')
  const mine = h.filter((x) => x.summary.added || x.summary.changed)
  assert.equal(mine[0].author, '김철수')
  assert.deepEqual(mine[0].summary, { added: 5, removed: 0, changed: 0 })
  const last = h.at(-1)
  assert.equal(last.author, '이영희')
  assert.deepEqual(last.summary, { added: 1, removed: 0, changed: 1 })
  assert.ok(last.text.includes('B 가 고침'))
})

test('주소의 위쪽 폴더가 없는데 서버가 405 만 주면 — 연결 시험 첫 단계에서 주소가 틀렸다고 말한다', async () => {
  const { davClient, probe } = await import('../src/remote.js')
  const server = memDav()
  // Koofr 에서 `…/dav/koofr/…` 처럼 대소문자가 틀리면: 부모가 없어도 MKCOL 에 405 를 준다
  const picky = async (req) => {
    const r = await server.transport(req)
    return req.method === 'MKCOL' && r.status === 409 ? { ...r, status: 405 } : r
  }
  const p = await probe(davClient('http://fake/dav/없는폴더/노트', picky))
  assert.equal(p.ok, false)
  assert.equal(p.steps.length, 1)
  assert.match(p.steps[0].note, /위쪽 폴더를 확인/)
  assert.match(p.steps[0].note, /없는폴더\/노트/)
})

test('그림 — 새 그림은 올리고, 다른 기기는 볼 때 받는다 · 받은 것을 도로 올리지 않는다', async () => {
  const { fetchAsset } = await import('../src/engine.js')
  const w = world()
  const A = w.dev('A', { 'sub/a.md': '# A\n\n![](.image/p1.png)\n' })
  A.fs.paste('/r/sub/.image/p1.png', 'iVBORw0KGgo=')
  const ra = await A.sync()
  assert.equal(ra.assetsUp, 1)
  assert.deepEqual(w.server.files.get('notes/sub/.image/p1.png'), { b64: 'iVBORw0KGgo=' })
  const again = await A.sync()
  assert.equal(again.assetsUp, 0)

  const B = w.dev('B')
  await B.fetchAll()
  assert.equal(B.fs.bins.size, 0)             // 문서만 받았다 — 그림은 아직
  const ok = await fetchAsset({ root: '/r', store: w.server.client(), fs: B.fs }, 'sub/.image/p1.png')
  assert.equal(ok, true)
  assert.equal(B.fs.bins.get('/r/sub/.image/p1.png'), 'iVBORw0KGgo=')
  const rb = await B.sync()
  assert.equal(rb.assetsUp, 0)                // 받은 것을 도로 올리지 않는다
  assert.equal(await fetchAsset({ root: '/r', store: w.server.client(), fs: B.fs }, 'sub/.image/없음.png'), false)
})

test('전체 점검(full) — 맞는 것은 그대로, 원격에서 사라진 그림은 다시 올린다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC + '\n![](.image/p.png)\n', 'b.md': '# B\n' })
  A.fs.paste('/r/.image/p.png', 'iVBORw0KGgo=')
  const B = w.dev('B')
  await A.sync(); await B.fetchAll(); await A.sync()
  const r = await A.sync({ full: true })
  assert.deepEqual([r.pulled, r.pushed, r.conflicts, r.changedPaths.length, r.assetsUp], [0, 0, 0, 0, 0])
  const rb = await B.sync({ full: true })
  assert.deepEqual([rb.pulled, rb.pushed, rb.conflicts, rb.changedPaths.length], [0, 0, 0, 0])

  w.server.files.delete('notes/.image/p.png')
  assert.equal((await A.sync()).assetsUp, 0)         // 보통 맞추기는 모른다
  assert.equal((await A.sync({ full: true })).assetsUp, 1)
  assert.ok(w.server.files.get('notes/.image/p.png'))
})

test('그림 하나가 실패해도 나머지는 올리고 문서 기록도 남는다 — 다음 번에 실패한 것만', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': '# A\n\n![](.image/1.png) ![](.image/2.png) ![](.image/3.png)\n' })
  for (const n of [1, 2, 3]) A.fs.paste(`/r/.image/${n}.png`, 'iVBORw0KGgo=')
  const good = w.server.client()
  const flaky = { ...good, putBinary: (rel, ...rest) => (rel.endsWith('2.png') ? Promise.reject(new Error('올리기 실패: 서버 응답 500')) : good.putBinary(rel, ...rest)) }
  const r1 = await A.sync({ store: flaky })
  assert.equal(r1.assetsUp, 2)
  assert.equal(r1.failed.length, 1)
  assert.match(r1.failed[0], /2\.png/)
  assert.ok(w.server.files.get('notes/.mdsync/devices/A/index.json'))   // 문서 기록은 남았다
  const r2 = await A.sync()
  assert.deepEqual([r2.assetsUp, r2.failed.length, r2.pushed], [1, 0, 0])
})

test('도장 — 아무것도 안 바뀌었으면 원격에 한 번만 묻고 끝, 바뀌면 제대로 본다', async () => {
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  const B = w.dev('B')
  await A.sync(); await B.fetchAll(); await A.sync(); await B.sync()
  assert.ok(w.server.files.get('notes/.mdsync-stamp'))

  // 원격 요청을 센다
  let calls = 0
  const counted = (c) => Object.fromEntries(Object.entries(c).map(([k, f]) => [k, typeof f === 'function' ? (...a) => { calls++; return f(...a) } : f]))
  const quiet = await A.sync({ store: counted(w.server.client()) })
  assert.equal(quiet.fast, true)
  assert.equal(calls, 1)

  // B 가 고치면 A 는 빠른 길을 타지 않고 받아 온다
  B.edit('a.md', DOC + '\nB 가 더함.\n'); await B.sync()
  const r = await A.sync()
  assert.ok(!r.fast)
  assert.equal(r.pulled, 1)
  assert.match(A.read('a.md'), /B 가 더함/)

  // 로컬에서 고쳐도 빠른 길을 타지 않는다
  assert.equal((await A.sync()).fast, true)
  A.edit('a.md', A.read('a.md') + '\nA 가 더함.\n')
  const r2 = await A.sync()
  assert.ok(!r2.fast)
  assert.equal(r2.pushed, 1)
  // 전체 점검은 도장을 믿지 않는다
  assert.ok(!(await A.sync({ full: true })).fast)
})

test('저장소 찾기 — 상위 폴더 아래 동기화 저장소들만 고른다', async () => {
  const { findRepos, davClient } = await import('../src/remote.js')
  const w = world()
  const A = w.dev('A', { 'a.md': DOC })
  await A.sync()                                         // notes/ 가 저장소가 된다
  // 동기화 기록이 없는 평범한 폴더
  const parent = davClient('http://fake/dav', w.server.transport)
  await parent.mkdirs('plain')
  await parent.put('plain/x.md', '# x')
  const found = await findRepos(parent)
  assert.deepEqual(found.map((r) => r.name), ['notes'])
  // 저장소 주소 자체를 넣으면 그것 하나
  assert.deepEqual((await findRepos(w.server.client())).map((r) => r.self), [true])
})
