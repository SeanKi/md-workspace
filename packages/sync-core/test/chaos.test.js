import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memFs, memDav } from './fakes.js'
import { syncRepo } from '../src/engine.js'

/*
 * 혼돈 시험 — 기기 셋이 여러 문서를 아무렇게나 고치고, 아무 순서로 맞춘다.
 * 확인하는 것:
 *   1. 끝에 모든 기기의 모든 문서가 **같다**
 *   2. 고친 것이 **사라지지 않는다** — 누가 그 문단을 지우지 않은 한, 붙인 표시가 남아 있다
 *   3. 마지막에 한 번 더 맞추면 아무것도 오가지 않는다 (가라앉는다)
 */

function makeRng(seed) {
  let s = seed
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n }
}

async function run(seed) {
  const server = memDav()
  const rnd = makeRng(seed)
  const start = Array.from({ length: 10 }, (_, i) => `문단 ${i}.`).join('\n\n') + '\n'
  const ids = ['A', 'B', 'C']
  const devs = ids.map((id, i) => {
    const files = i === 0 ? { '/r/x.md': start, '/r/y.md': start.replace(/문단/g, '줄') } : {}
    const fs = memFs(files)
    return { id, fs, sync: () => syncRepo({ root: '/r', store: server.client(), fs, device: id, want: ['x.md', 'y.md'] }) }
  })
  for (const d of devs) await d.sync()

  const kept = new Map()   // 표시 → 그 표시를 붙인 문단이 나중에 지워졌나
  for (let round = 0; round < 8; round++) {
    for (const d of devs) {
      for (const doc of ['x.md', 'y.md']) {
        if (rnd(3) === 0) continue
        const t = d.fs.files.get(`/r/${doc}`)
        if (t == null) continue
        const ps = t.trimEnd().split('\n\n')
        const op = rnd(4)
        const i = rnd(ps.length)
        const tag = `[${d.id}${round}${doc[0]}]`
        if (op === 0 || op === 1) { ps[i] = `${ps[i]} ${tag}`; kept.set(tag, true) }
        else if (op === 2) { ps.splice(i, 0, `새 ${tag}`); kept.set(tag, true) }
        else if (ps.length > 3) {
          // 지우는 문단에 붙어 있던 표시는 사라져도 된다
          for (const k of kept.keys()) if (ps[i].includes(k)) kept.set(k, false)
          ps.splice(i, 1)
        }
        d.fs.edit(`/r/${doc}`, ps.join('\n\n') + '\n')
      }
    }
    // 아무 순서로, 일부만 맞춘다
    const order = [...devs].sort(() => rnd(3) - 1)
    for (const d of order) if (rnd(4) !== 0) await d.sync()
  }
  for (let i = 0; i < 3; i++) for (const d of devs) await d.sync()

  for (const doc of ['x.md', 'y.md']) {
    const texts = devs.map((d) => d.fs.files.get(`/r/${doc}`))
    assert.equal(texts[1], texts[0], `seed ${seed} ${doc}: B 와 A 가 다르다`)
    assert.equal(texts[2], texts[0], `seed ${seed} ${doc}: C 와 A 가 다르다`)
  }
  const all = devs[0].fs.files.get('/r/x.md') + devs[0].fs.files.get('/r/y.md')
  for (const [tag, alive] of kept) {
    if (alive) assert.ok(all.includes(tag), `seed ${seed}: 고친 것 ${tag} 이 사라졌다`)
  }
  for (const d of devs) {
    const r = await d.sync()
    assert.deepEqual([r.pushed, r.conflicts], [0, 0], `seed ${seed}: ${d.id} 가 가라앉지 않았다`)
  }
}

test('혼돈 — 30가지 순서', async () => {
  for (let seed = 1; seed <= 30; seed++) await run(seed)
})
