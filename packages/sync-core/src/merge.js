import { diff3Merge } from 'node-diff3'
import { hash, lcsPairs } from './blocks.js'

/*
 * 블록 단위 3-way 병합.
 *
 *   base   — 둘이 마지막으로 같았던 판 (지난번에 그 기기에서 받아 합친 목록)
 *   local  — 내 지금 판
 *   remote — 그 기기의 지금 판
 *
 * | 상황 | 결과 |
 * |---|---|
 * | 한쪽만 바꾼 블록 | 바뀐 쪽 |
 * | 서로 다른 블록을 고침 | 둘 다 (노션처럼 "그냥 합쳐짐") |
 * | 한쪽이 지움 · 다른 쪽은 그대로 | 지운다 |
 * | 한쪽이 지움 · 다른 쪽은 고침 | **고친 것이 산다** — 글이 사라지는 쪽이 더 나쁘다 |
 * | 같은 블록을 둘 다 고침 | 줄 단위 3-way 로 합쳐 보고, 겹치면 한 판을 남기고 다른 판은 **충돌 블록**으로 바로 아래에 |
 *
 * 충돌을 어느 쪽이 이기는지는 **내용의 해시로** 정한다 — 두 기기가 서로를 합칠 때 같은 결과가
 * 나와야 충돌 블록이 오가며 불어나지 않는다. 충돌 블록의 ID 도 같은 까닭으로 내용에서 만든다.
 */

const byId = (list) => new Map(list.map((b) => [b.id, b]))
const lines = (s) => s.split(/(?<=\n)/)

/** 같은 블록을 둘 다 고쳤을 때 — 줄 단위로 합쳐 본다. 겹치면 null */
export function mergeText(base, mine, theirs) {
  const regions = diff3Merge(lines(mine), lines(base), lines(theirs))
  let out = ''
  for (const r of regions) {
    if (r.conflict) return null
    out += r.ok.join('')
  }
  return out
}

/** 진 판을 담는 충돌 블록. 인용문 하나라 마크다운 블록 하나로 남는다 */
export function conflictBlock(loser, of, label = '다른 기기') {
  const body = loser.text.replace(/^\s+/, '').replace(/\s+$/, '')
  const quoted = body.split(/\r?\n/).map((l) => (l ? `> ${l}` : '>')).join('\n')
  const text = `\n\n> ⚠ **동기화 충돌** — ${label}에서 같은 문단을 다르게 고쳤습니다. 위가 남긴 판, 아래가 다른 판입니다. 확인한 뒤 이 인용을 지우세요.\n>\n${quoted}`
  return { id: `${of}~${loser.hash.slice(0, 10)}`, hash: hash(text), text, conflict: true }
}

/**
 * @returns {{ list, conflicts: number }}
 */
export function merge3(base, local, remote, { label } = {}) {
  const B = byId(base)
  const L = byId(local)
  const R = byId(remote)
  const keep = new Map()      // id → 남길 블록
  const extra = new Map()     // id → 그 뒤에 붙일 충돌 블록
  let conflicts = 0

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id)
    const l = L.get(id)
    const r = R.get(id)
    if (l && r) {
      if (l.hash === r.hash) keep.set(id, l)
      else if (b && l.hash === b.hash) keep.set(id, r)
      else if (b && r.hash === b.hash) keep.set(id, l)
      else {
        const text = b ? mergeText(b.text, l.text, r.text) : null
        if (text !== null) keep.set(id, { id, hash: hash(text), text })
        else {
          // 이미 상대 판이 충돌 블록으로 들어와 있으면(내가 전에 합친 것) 다시 만들지 않는다
          const [win, lose] = l.hash > r.hash ? [l, r] : [r, l]
          keep.set(id, win)
          const cb = conflictBlock(lose, id, label)
          if (!L.has(cb.id) && !R.has(cb.id)) { extra.set(id, cb); conflicts++ }
        }
      }
    } else if (l) {
      // 상대가 지웠다 — 내가 그대로였으면 따라 지우고, 고쳤으면 남긴다
      if (!b || l.hash !== b.hash) keep.set(id, l)
    } else if (r) {
      if (!b || r.hash !== b.hash) keep.set(id, r)
    }
  }

  // 순서: 상대의 순서를 바탕으로, 나에게만 있는 블록은 내 쪽 바로 앞 이웃 뒤에 끼운다
  const order = remote.filter((x) => keep.has(x.id)).map((x) => x.id)
  const placed = new Set(order)
  let after = null
  for (const x of local) {
    if (!keep.has(x.id)) continue
    if (!placed.has(x.id)) {
      const at = after === null ? 0 : order.indexOf(after) + 1
      order.splice(at, 0, x.id)
      placed.add(x.id)
    }
    after = x.id
  }
  const list = []
  for (const id of order) {
    list.push(keep.get(id))
    if (extra.has(id)) list.push(extra.get(id))
  }
  return { list, conflicts }
}

/**
 * 두 기기가 처음 만났을 때 — 지난번 판(base)이 없다. 내용이 같은 블록끼리 맞추고
 * (ID 도 상대 것으로 맞춘다) 그 공통 부분을 base 로 삼는다. 다른 것은 양쪽에서 "더한" 것이
 * 되어 둘 다 남는다 — 처음 맞추는 자리에서는 아무것도 버리지 않는다.
 *
 * @returns {{ base, local }} local 은 ID 를 맞춘 내 목록
 */
export function firstContact(local, remote) {
  const pairs = lcsPairs(local, remote)
  const mine = local.map((b) => ({ ...b }))
  const base = []
  for (const [i, j] of pairs) {
    mine[i].id = remote[j].id
    base.push({ ...remote[j] })
  }
  return { base, local: mine }
}
