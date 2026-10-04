import { test } from 'node:test'
import assert from 'node:assert/strict'
import { v2 as webdav } from 'webdav-server'
import { memFs } from './fakes.js'
import { syncRepo } from '../src/engine.js'
import { davClient, probe } from '../src/remote.js'

/*
 * 진짜 WebDAV 서버(webdav-server, 메모리)에 HTTP 로 붙어서 — PROPFIND 응답 읽기, 폴더 만들기,
 * 한글 경로 인코딩, Basic 인증이 실제 구현과 맞는지 본다. 앱은 같은 일을 Rust(ureq)로 보낸다.
 */

async function startServer() {
  const users = new webdav.SimpleUserManager()
  const user = users.addUser('tester', 'pw', false)
  const privileges = new webdav.SimplePathPrivilegeManager()
  privileges.setRights(user, '/', ['all'])
  const server = new webdav.WebDAVServer({
    port: 0,
    httpAuthentication: new webdav.HTTPBasicAuthentication(users, 'test'),
    privilegeManager: privileges,
  })
  await new Promise((r) => server.start(r))
  const port = server.server.address().port
  return { server, base: `http://127.0.0.1:${port}` }
}

const auth = 'Basic ' + Buffer.from('tester:pw').toString('base64')
const fetchTransport = async ({ method, url, headers = [], body }) => {
  const r = await fetch(url, { method, headers: [...headers, ['Authorization', auth]], body })
  return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() }
}

test('진짜 WebDAV 서버 — 연결 시험 · 올리기 · 클론 · 양쪽 고침', async () => {
  const { server, base } = await startServer()
  try {
    const dav = () => davClient(`${base}/내 노트`, fetchTransport)

    const p = await probe(dav())
    assert.ok(p.ok, JSON.stringify(p.steps))

    const A = memFs({ '/r/회의/첫 회의.md': '# 첫 회의\n\n안건 하나.\n\n안건 둘.\n', '/r/b.md': '# B\n' })
    const B = memFs({})
    const sync = (fs, id, opts = {}) => syncRepo({ root: '/r', store: dav(), fs, device: id, ...opts })

    await sync(A, 'A')
    // 원격에는 사람이 읽는 거울이 그대로 있다
    assert.equal(await dav().get('회의/첫 회의.md'), '# 첫 회의\n\n안건 하나.\n\n안건 둘.\n')
    const listed = await sync(B, 'B')
    assert.deepEqual(listed.catalog.map((c) => c.path).sort(), ['b.md', '회의/첫 회의.md'])
    await sync(B, 'B', { want: ['회의/첫 회의.md'] })
    assert.equal(B.files.get('/r/회의/첫 회의.md'), A.files.get('/r/회의/첫 회의.md'))

    A.edit('/r/회의/첫 회의.md', '# 첫 회의\n\n안건 하나 — A.\n\n안건 둘.\n')
    B.edit('/r/회의/첫 회의.md', '# 첫 회의\n\n안건 하나.\n\n안건 둘 — B.\n')
    await sync(A, 'A'); await sync(B, 'B'); await sync(A, 'A')
    const want = '# 첫 회의\n\n안건 하나 — A.\n\n안건 둘 — B.\n'
    assert.equal(A.files.get('/r/회의/첫 회의.md'), want)
    assert.equal(B.files.get('/r/회의/첫 회의.md'), want)
  } finally {
    await new Promise((r) => server.stop(r))
  }
})

test('비밀번호가 틀리면 알아들을 수 있게 말한다', async () => {
  const { server, base } = await startServer()
  try {
    const bad = async (req) => {
      const r = await fetch(req.url, { method: req.method, headers: [...(req.headers ?? []), ['Authorization', 'Basic ' + Buffer.from('tester:틀림').toString('base64')]], body: req.body })
      return { status: r.status, headers: {}, body: await r.text() }
    }
    const p = await probe(davClient(`${base}/x`, bad))
    assert.equal(p.ok, false)
    assert.match(p.steps.at(-1).note, /인증 실패/)
  } finally {
    await new Promise((r) => server.stop(r))
  }
})
