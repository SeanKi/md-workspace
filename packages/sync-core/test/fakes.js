/*
 * 시험용 가짜 — 메모리 파일 시스템과 메모리 WebDAV 서버.
 * WebDAV 는 일부러 **까다로운 서버**처럼 군다: 부모 폴더가 없으면 409, 조건부 쓰기 없음.
 */
import { davClient } from '../src/remote.js'

export function memFs(files = {}) {
  const m = new Map(Object.entries(files))
  let clock = 1
  const times = new Map([...m.keys()].map((k) => [k, clock++]))
  const norm = (p) => p.replace(/\\/g, '/')
  const bins = new Map()   // 그림 — 경로 → base64
  return {
    files: m,
    bins,
    async listAssets(root) {
      const pre = norm(root) + '/'
      return [...bins].filter(([p]) => p.startsWith(pre) && !p.includes('/.mdsync/'))
        .map(([p, b]) => ({ rel: p.slice(pre.length), size: b.length, mtime: times.get(p) }))
    },
    async readB64(p) { return bins.get(norm(p)) ?? null },
    async writeB64(p, b) { p = norm(p); bins.set(p, b); times.set(p, clock++) },
    /** 그림을 붙여 넣은 것처럼 */
    paste(p, b) { bins.set(p, b); times.set(p, clock++) },
    async list(root) {
      const pre = norm(root) + '/'
      const out = []
      for (const [p, t] of m) {
        if (!p.startsWith(pre)) continue
        const rel = p.slice(pre.length)
        if (rel.split('/').some((s) => s.startsWith('.'))) continue
        if (!/\.(md|markdown|mdx)$/i.test(rel)) continue
        out.push({ rel, size: t.length, mtime: times.get(p) })
      }
      return out
    },
    async stat(p) {
      p = norm(p)
      if (m.has(p)) return { size: m.get(p).length, mtime: times.get(p) }
      return bins.has(p) ? { size: bins.get(p).length, mtime: times.get(p) } : null
    },
    async read(p) { p = norm(p); return m.has(p) ? m.get(p) : null },
    async write(p, t) { p = norm(p); m.set(p, t); times.set(p, clock++) },
    async remove(p) { p = norm(p); m.delete(p); times.delete(p) },
    /** 사용자가 편집기에서 고친 것처럼 */
    edit(p, t) { m.set(p, t); times.set(p, clock++) },
  }
}

export function memDav() {
  const files = new Map()
  const dirs = new Set([''])
  const pathOf = (url) => decodeURIComponent(new URL(url).pathname).replace(/^\/dav\/?/, '').replace(/\/+$/, '')
  const parent = (p) => p.split('/').slice(0, -1).join('/')
  let requests = 0
  const transport = async ({ method, url, body, body_b64, binary }) => {
    requests++
    const p = pathOf(url)
    switch (method) {
      case 'MKCOL':
        if (dirs.has(p)) return { status: 405, headers: {}, body: '' }
        if (!dirs.has(parent(p))) return { status: 409, headers: {}, body: '' }
        dirs.add(p)
        return { status: 201, headers: {}, body: '' }
      case 'PUT':
        if (!dirs.has(parent(p))) return { status: 409, headers: {}, body: '' }
        files.set(p, body_b64 != null ? { b64: body_b64 } : body)
        return { status: 201, headers: {}, body: '' }
      case 'GET':
        if (!files.has(p)) return { status: 404, headers: {}, body: '' }
        {
          const v = files.get(p)
          const out = typeof v === 'object' ? (binary ? v.b64 : Buffer.from(v.b64, 'base64').toString()) : (binary ? Buffer.from(v).toString('base64') : v)
          return { status: 200, headers: {}, body: out }
        }
      case 'DELETE':
        files.delete(p)
        return { status: 204, headers: {}, body: '' }
      case 'PROPFIND': {
        if (!dirs.has(p)) return { status: 404, headers: {}, body: '' }
        const kids = [...dirs].filter((d) => d && parent(d) === p).map((d) => ({ d, dir: true }))
          .concat([...files.keys()].filter((f) => parent(f) === p).map((d) => ({ d, dir: false })))
        const resp = (path, dir) => `<D:response><D:href>/dav/${path.split('/').map(encodeURIComponent).join('/')}${dir ? '/' : ''}</D:href><D:propstat><D:prop><D:resourcetype>${dir ? '<D:collection/>' : ''}</D:resourcetype></D:prop></D:propstat></D:response>`
        const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${resp(p, true)}${kids.map((k) => resp(k.d, k.dir)).join('')}</D:multistatus>`
        return { status: 207, headers: {}, body: xml }
      }
      default:
        return { status: 405, headers: {}, body: '' }
    }
  }
  return { files, dirs, transport, client: () => davClient('http://fake/dav/notes', transport), get requests() { return requests } }
}
