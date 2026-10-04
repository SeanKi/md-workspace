/*
 * WebDAV 클라이언트. 요청 하나를 보내는 일(transport)은 밖에서 받는다 —
 * 앱에서는 Rust(`md-core/dav.rs`, CORS 를 피하려고), 시험에서는 fetch 나 메모리 가짜.
 *
 *   transport({ method, url, headers, body }) → { status, headers, body }
 *
 * 서버가 무엇을 지원하는지에 기대지 않는다. ETag 조건부 쓰기(`If-Match`)나 잠금(LOCK)이
 * 없어도 된다 — 동기화는 기기마다 **자기 이름의 파일만** 쓰도록 짜여 있다 (engine.js).
 */

const enc = (path) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/')

/** PROPFIND 응답에서 이름·폴더 여부만 뽑는다. 이름공간 접두어(d: D: 없음)는 서버마다 다르다 */
export function parseMultistatus(xml, baseHref) {
  const out = []
  const tag = (name) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi')
  for (const m of xml.matchAll(tag('response'))) {
    const block = m[1]
    const href = (/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i.exec(block) ?? [])[1]?.trim()
    if (!href) continue
    let path
    try { path = decodeURIComponent(href.replace(/^https?:\/\/[^/]+/i, '')) } catch { path = href }
    const isDir = /<(?:[\w-]+:)?collection\b/i.test(block)
    const etag = (/<(?:[\w-]+:)?getetag\b[^>]*>([\s\S]*?)<\//i.exec(block) ?? [])[1]?.trim() ?? null
    const name = path.replace(/\/+$/, '').split('/').pop()
    out.push({ path, name, isDir, etag })
  }
  // 첫 줄은 대개 그 폴더 자신이다
  const self = decodeURIComponent(new URL(baseHref).pathname).replace(/\/+$/, '')
  return out.filter((e) => e.path.replace(/\/+$/, '') !== self)
}

export function davClient(baseUrl, transport) {
  const base = baseUrl.replace(/\/+$/, '')
  const url = (path) => (path ? `${base}/${enc(path)}` : base)
  const made = new Set()
  /** 실패 문구에 **어느 주소였는지**를 붙인다 — 주소를 잘못 넣은 것이 가장 흔한 원인이다 */
  const where = (full) => { try { return decodeURIComponent(new URL(full).pathname) } catch { return full } }
  const fail = (what, r, full) => {
    const why = r.status === 401 ? '인증 실패 — 아이디·비밀번호(앱 비밀번호)를 확인하세요'
      : r.status === 403 ? '권한이 없습니다'
        : r.status === 404 ? '그런 폴더가 없습니다 — 주소를 확인하세요 (대소문자까지 같아야 합니다)'
          : r.status === 507 ? '서버 저장 공간이 모자랍니다'
            : `서버 응답 ${r.status}`
    return new Error(`${what}: ${why}${full ? ` [${where(full)}]` : ''}`)
  }

  /** 정말 있는가 — PROPFIND Depth 0. MKCOL 의 "405 이미 있다" 를 믿지 않으려고 쓴다 */
  async function exists(path) {
    const r = await transport({ method: 'PROPFIND', url: url(path) + '/', headers: [['Depth', '0']] })
    if (r.status === 207 || r.status === 200) return true
    if (r.status === 404) return false
    throw fail(`확인 ${path || '(원격 폴더)'}`, r, url(path) + '/')
  }

  /**
   * 원격 주소 자체(저장소 뿌리)가 아직 없을 수 있다 — 새 폴더 이름을 적어 넣은 경우.
   * 서버에 따라 **위쪽 폴더가 없을 때도 405** 를 준다 (Koofr 에서 `…/dav/koofr/…` 처럼 대소문자가
   * 틀린 경우). 그래서 만든 뒤 정말 있는지 확인한다.
   */
  async function root() {
    if (made.has('')) return
    const r = await transport({ method: 'MKCOL', url: base + '/' })
    if (![201, 405, 301, 200].includes(r.status)) throw fail('원격 폴더 만들기', r, base + '/')
    if (r.status !== 201 && !(await exists(''))) {
      throw new Error(`원격 폴더를 찾을 수도 만들 수도 없습니다 — 주소의 위쪽 폴더를 확인하세요. Koofr 는 https://app.koofr.net/dav/Koofr/폴더 처럼 대소문자까지 같아야 합니다 [${where(base)}]`)
    }
    made.add('')
  }

  async function mkcol(path) {
    if (!path || made.has(path)) return
    // 뿌리를 먼저 확인한다 — 뿌리가 없는데 405 를 "이미 있다" 로 믿으면 쓰기에서야 404 로 드러난다
    if (!made.has('')) await root()
    const r = await transport({ method: 'MKCOL', url: url(path) + '/' })
    // 201 만들었다 · 405 이미 있다 · 301 이미 있다(슬래시 없이 물었다)
    if (r.status === 201 || r.status === 405 || r.status === 301 || r.status === 200) { made.add(path); return }
    if (r.status === 409) {   // 부모가 없다
      const up = path.split('/').slice(0, -1).join('/')
      if (up) await mkdirs(up)
      else await root()
      const again = await transport({ method: 'MKCOL', url: url(path) + '/' })
      if ([201, 405, 301, 200].includes(again.status)) { made.add(path); return }
      throw fail(`폴더 만들기 ${path}`, again, url(path) + "/")
    }
    throw fail(`폴더 만들기 ${path}`, r, url(path) + "/")
  }

  async function mkdirs(path) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) await mkcol(parts.slice(0, i).join('/'))
  }

  return {
    url,
    mkdirs,
    exists,
    ensureRoot: root,

    /** 글을 읽는다. 없으면 null */
    async get(path) {
      const r = await transport({ method: 'GET', url: url(path) })
      if (r.status === 404) return null
      if (r.status >= 200 && r.status < 300) return r.body
      throw fail(`읽기 ${path}`, r, url(path))
    },

    /** 글을 쓴다. 부모 폴더가 없으면 만든다 */
    async put(path, text, contentType = 'text/plain; charset=utf-8') {
      const send = () => transport({ method: 'PUT', url: url(path), headers: [['Content-Type', contentType]], body: text })
      let r = await send()
      if (r.status === 409 || r.status === 404) {
        await mkdirs(path.split('/').slice(0, -1).join('/'))
        r = await send()
      }
      if (r.status >= 200 && r.status < 300) return
      throw fail(`쓰기 ${path}`, r, url(path))
    },

    /** 그림 같은 바이너리 — base64 로 오간다 (앱에서는 Rust 가 바이트로 바꿔 보낸다). 없으면 null */
    async getBinary(path) {
      const r = await transport({ method: 'GET', url: url(path), binary: true })
      if (r.status === 404) return null
      if (r.status >= 200 && r.status < 300) return r.body
      throw fail(`받기 ${path}`, r, url(path))
    },

    async putBinary(path, b64, contentType = 'application/octet-stream') {
      const send = () => transport({ method: 'PUT', url: url(path), headers: [['Content-Type', contentType]], body_b64: b64 })
      // 폴더부터 만든다. 큰 파일을 없는 폴더에 보내면 서버가 409 를 **받는 도중에** 답하고 연결을 끊는다 —
      // 그러면 409 는 못 보고 "연결 중단(os error 10053)" 만 남아, 409 를 보고 폴더를 만드는 길이 영영 안 열린다.
      // Koofr 에서 15MB 넘는 그림 다섯 개가 그렇게 매번 실패했다. 만든 폴더는 기억하므로 폴더마다 한 번이다
      const dir = path.split('/').slice(0, -1).join('/')
      if (dir) await mkdirs(dir)
      let r = await send()
      if (r.status === 409 || r.status === 404) {
        await mkdirs(path.split('/').slice(0, -1).join('/'))
        r = await send()
      }
      if (r.status >= 200 && r.status < 300) return
      throw fail(`올리기 ${path}`, r, url(path))
    },

    async del(path) {
      const r = await transport({ method: 'DELETE', url: url(path) })
      if (r.status === 404 || (r.status >= 200 && r.status < 300)) return
      throw fail(`지우기 ${path}`, r, url(path))
    },

    /** 폴더 한 단계. 없으면 [] */
    async list(path) {
      const target = url(path) + '/'
      const r = await transport({
        method: 'PROPFIND', url: target,
        headers: [['Depth', '1'], ['Content-Type', 'application/xml; charset=utf-8']],
        body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>',
      })
      if (r.status === 404) return []
      if (r.status !== 207) throw fail(`목록 ${path}`, r, url(path) + "/")
      return parseMultistatus(r.body, target)
    },
  }
}

/**
 * 연결 시험 — 서버가 동기화에 필요한 일을 하는지 실제로 해 본다.
 * 시험 파일은 `.mdsync/probe/` 에 만들었다가 지운다.
 */
export async function probe(dav) {
  const steps = []
  const step = async (name, fn) => {
    try { const note = await fn(); steps.push({ name, ok: true, note }) } catch (e) { steps.push({ name, ok: false, note: String(e.message ?? e) }); throw e }
  }
  const p = `.mdsync/probe/${Date.now().toString(36)}.txt`
  const text = '동기화 시험 — 한글 ✓\n'
  try {
    // 주소의 폴더가 정말 있는가 — 없으면 만들어 보고, 그것도 안 되면 주소가 틀린 것이다
    await step('주소 확인 (원격 폴더)', async () => { await dav.ensureRoot(); return `${(await dav.list('')).length}개 항목` })
    // 서버가 "이미 있다(405)" 고만 하고 실제로는 안 만드는 경우가 있어 다시 확인한다
    await step('폴더 만들기', async () => {
      await dav.mkdirs('.mdsync/probe')
      if (!(await dav.exists('.mdsync/probe'))) throw new Error('만들었다는데 없습니다 — 이 서버는 점(.)으로 시작하는 폴더를 받지 않을 수 있습니다')
    })
    await step('쓰기', () => dav.put(p, text))
    await step('읽기 (한글 그대로인가)', async () => {
      const back = await dav.get(p)
      if (back !== text) throw new Error('쓴 글과 읽은 글이 다릅니다')
      return '같다'
    })
    await step('지우기', () => dav.del(p))
    return { ok: true, steps }
  } catch {
    return { ok: false, steps }
  }
}
