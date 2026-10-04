import { parseMarkdown } from '@md/md-bridge'

/*
 * 문서 ⇄ 블록.
 *
 * 블록 하나 = **원문 조각 그대로** (앞의 틈 + 블록 원문). 이어 붙이면 파일이 한 바이트도
 * 다르지 않게 돌아온다 (md-bridge 의 원본 보존과 같은 자름). 그래서 동기화가 손대지 않은
 * 블록은 다른 기기에서도 글자 하나 바뀌지 않는다.
 *
 * 블록마다 ID 를 붙여 기기 사이에서 "같은 문단" 을 알아본다. ID 는 파일에 쓰지 않는다 —
 * 지난번 목록과 맞춰 이어받는다 (`assignIds`).
 */

/** 53비트 해시 (cyrb53). 노트 몇천 개 규모에서 겹칠 일이 없고, 동기식이라 빠르다 */
export function hash(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** 글 → 원문 조각들. 이어 붙이면 원래 글 그대로다 */
export function toChunks(text) {
  if (!text) return []
  const p = parseMarkdown(text)
  if (!p.blocks.length) return [text]
  const chunks = p.blocks.map((b) => b.gap + b.src)
  if (p.bom) chunks[0] = '﻿' + chunks[0]
  // 문서 끝의 줄바꿈은 따로 둔다. 마지막 블록에 붙여 두면 끝에 글을 덧붙일 때마다
  // 마지막 문단이 "고친 것" 이 되어, 다른 기기가 그 문단을 고쳤으면 괜한 충돌이 난다
  if (p.trailing) chunks.push(p.trailing)
  return chunks
}

const nlCount = (s) => (s.match(/\n/g) || []).length
const trailingNl = (s) => nlCount(/(?:\r?\n[ \t]*)*$/.exec(s)[0])
const leadingNl = (s) => nlCount(/^(?:[ \t]*\r?\n)*/.exec(s)[0])

/**
 * 블록들 → 글. 원래 이웃이던 블록 사이는 원래 틈 그대로다. 병합으로 순서가 바뀌거나 사이에
 * 블록이 끼었으면 **빈 줄 하나를 보장한다** — 안 그러면 줄바꿈 하나로 이어지던 문단이
 * 엉뚱한 블록에 들러붙는다 (마크다운에서 빈 줄 없는 두 줄은 한 문단이다).
 *
 * @param list   [{ id, text }]
 * @param prevOf Map(id → 원래 바로 앞에 있던 id, 또는 그런 id 들의 Set — 여러 판에서 모은 것)
 */
export function joinBlocks(list, prevOf = new Map()) {
  let out = ''
  let prev = null
  for (const b of list) {
    const p = prevOf.get(b.id)
    const neighbours = p instanceof Set ? p.has(prev) : p === prev
    if (out && !neighbours) {
      const have = trailingNl(out) + leadingNl(b.text)
      if (have < 2) out += (out.includes('\r\n') ? '\r\n' : '\n').repeat(2 - have)
    }
    out += b.text
    prev = b.id
  }
  return out
}

/** 블록 목록에서 "누구 바로 앞이 누구였나" */
export const prevMap = (list) => new Map(list.map((b, i) => [b.id, i ? list[i - 1].id : null]))

/** 여러 판의 이웃 관계를 합친다 — 어느 판에서든 이웃이었으면 원래 틈을 믿는다 */
export function prevSets(...lists) {
  const m = new Map()
  for (const list of lists) {
    if (!list) continue
    list.forEach((b, i) => {
      if (!m.has(b.id)) m.set(b.id, new Set())
      m.get(b.id).add(i ? list[i - 1].id : null)
    })
  }
  return m
}

/* ---------- ID 이어받기 ---------- */

let counter = 0
export const newId = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 두 글이 얼마나 닮았나 (글자 두 개씩 묶은 것의 Dice 계수, 0~1) */
export function similarity(a, b) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  let hit = 0
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2)
    const n = grams.get(g)
    if (n) { hit++; grams.set(g, n - 1) }
  }
  return (2 * hit) / (a.length + b.length - 2)
}

/**
 * 두 목록의 최장 공통 부분열 — [i, j] 짝들.
 * 앞뒤로 같은 부분은 바로 짝짓는다 — 고친 곳은 대개 한두 군데라 표가 아주 작아진다.
 */
export function lcsPairs(a0, b0, key = (x) => x.hash) {
  let head = 0
  while (head < a0.length && head < b0.length && key(a0[head]) === key(b0[head])) head++
  let tail = 0
  while (tail < a0.length - head && tail < b0.length - head
    && key(a0[a0.length - 1 - tail]) === key(b0[b0.length - 1 - tail])) tail++
  const a = a0.slice(head, a0.length - tail)
  const b = b0.slice(head, b0.length - tail)
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs = []
  for (let k = 0; k < head; k++) pairs.push([k, k])
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) { pairs.push([head + i, head + j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  for (let k = 0; k < tail; k++) pairs.push([a0.length - tail + k, b0.length - tail + k])
  return pairs
}

/**
 * 새로 자른 조각들에 지난번 목록의 ID 를 이어 준다.
 *   - 내용이 같은 블록(해시 LCS)은 그 ID
 *   - 같은 자리 사이에서 짝이 남은 블록은 충분히 닮았으면(0.5 이상) "고친 것" 으로 보고 그 ID
 *   - 나머지는 새 ID (새로 쓴 블록)
 *
 * @param prev   지난번 목록 [{ id, hash, text }]
 * @param chunks 지금 글의 조각들 (string[])
 */
export function assignIds(prev, chunks) {
  const now = chunks.map((text) => ({ id: null, hash: hash(text), text }))
  const pairs = lcsPairs(prev, now)
  for (const [i, j] of pairs) now[j].id = prev[i].id
  // 짝지어진 것들 사이의 빈 구간마다, 남은 것끼리 닮은 것을 짝짓는다
  const anchors = [[-1, -1], ...pairs, [prev.length, now.length]]
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [pi, pj] = anchors[k]
    const [qi, qj] = anchors[k + 1]
    const olds = prev.slice(pi + 1, qi)
    const news = now.slice(pj + 1, qj)
    const used = new Set()
    // 같은 자리에서 하나가 빠지고 하나가 들어왔으면 닮지 않았어도 "고친 것" 이다 —
    // 그래야 두 기기가 같은 문단을 고쳤을 때 충돌로 알아본다
    const one = olds.length === 1 && news.length === 1
    for (const nb of news) {
      let best = -1
      let bestScore = one ? 0 : 0.5
      olds.forEach((ob, x) => {
        if (used.has(x)) return
        const s = similarity(ob.text.trim(), nb.text.trim())
        if (s >= bestScore) { best = x; bestScore = s }
      })
      if (best >= 0) { used.add(best); nb.id = olds[best].id }
    }
  }
  const seen = new Set()
  for (const b of now) {
    // 같은 ID 가 두 번 나오면(복사한 문단) 뒤의 것은 새 블록이다
    if (!b.id || seen.has(b.id)) b.id = newId()
    seen.add(b.id)
  }
  return now
}
