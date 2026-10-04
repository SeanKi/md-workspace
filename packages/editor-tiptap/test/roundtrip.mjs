/*
 * 왕복 시험 — 실제 .md 묶음을 읽기만 한다 (파일을 쓰지 않는다).
 *
 *   node packages/editor-tiptap/test/roundtrip.mjs <폴더|파일> [...]
 *
 * 문서마다 두 가지를 잰다.
 *   1. 손대지 않고 저장 → **바이트 동일**한가 (원본 보존 직렬화)
 *   2. 모든 블록을 고쳤다고 치고 새로 쓰면 → 다시 읽은 구조가 **같은 뜻**인가
 *      (사용자가 그 블록을 고쳤을 때 무엇이 바뀌는지의 상한)
 * 그리고 위지윅으로 못 그려 원문으로 남은 조각(rawBlock · rawInline)을 센다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getSchema } from '@tiptap/core'
import { parseMarkdown, parseTree, bindOrigin, serializeDoc, norm } from '@md/md-bridge'
import { buildExtensions } from '../src/extensions.js'

const schema = getSchema(buildExtensions())
const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash', 'target', 'dist'])

function* walk(p) {
  const st = statSync(p)
  if (st.isFile()) { if (/\.md$/i.test(p)) yield p; return }
  for (const name of readdirSync(p)) {
    if (SKIP.has(name)) continue
    yield* walk(join(p, name))
  }
}

const tally = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n)

function countRaw(doc, kinds) {
  doc.descendants((n) => {
    if (n.type.name === 'rawBlock') tally(kinds, `block:${n.attrs.kind}`)
    if (n.type.name === 'rawInline') tally(kinds, `inline:${n.attrs.text.replace(/\s.*$/s, '').slice(0, 24)}`)
  })
}

const roots = process.argv.slice(2)
if (!roots.length) { console.error('사용법: node roundtrip.mjs <폴더|파일> ...'); process.exit(1) }

let files = 0, identical = 0, semantic = 0, bytes = 0, blocksAll = 0, blocksBound = 0
let slowest = { ms: 0, file: '' }
const failures = []
const changedByType = new Map()
const examples = new Map()
const rawKinds = new Map()

for (const root of roots) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    files++; bytes += text.length
    try {
      const t0 = performance.now()
      const parsed = parseMarkdown(text)
      const json = { type: 'doc', content: parsed.blocks.length ? parsed.blocks.map((b) => b.json) : [{ type: 'paragraph' }] }
      const doc = schema.nodeFromJSON(json)
      doc.check()
      const origin = bindOrigin(doc, parsed, schema)
      const out = serializeDoc(doc, parsed, origin).text
      const ms = performance.now() - t0
      if (ms > slowest.ms) slowest = { ms, file: relative(root, file), kb: Math.round(text.length / 1024) }
      blocksAll += origin.total; blocksBound += origin.bound
      if (out === text) identical++
      else failures.push({ file, why: '바이트 다름' })

      countRaw(doc, rawKinds)

      const full = serializeDoc(doc, parsed, null).text
      const a = norm(parseTree(text.replace(/^﻿/, '')).children)
      const b = norm(parseTree(full.replace(/^﻿/, '')).children)
      if (JSON.stringify(a) === JSON.stringify(b)) { semantic++; continue }
      // 어느 블록이 달라졌나 — 블록 수가 같을 때만 짝지어 본다
      if (a.length !== b.length) { tally(changedByType, '(블록 수가 달라짐)'); continue }
      a.forEach((x, i) => {
        if (JSON.stringify(x) === JSON.stringify(b[i])) return
        tally(changedByType, x.type)
        const ex = examples.get(x.type) ?? []
        if (ex.length < 4) {
          const blk = parsed.blocks[i]
          ex.push({ file: relative(root, file), before: blk?.src.slice(0, 160), after: '' })
          examples.set(x.type, ex)
        }
      })
    } catch (e) {
      failures.push({ file, why: String(e?.message ?? e).slice(0, 200) })
    }
  }
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-')
console.log(`\n문서 ${files}개 · ${(bytes / 1024 / 1024).toFixed(1)}MB`)
console.log(`① 손대지 않고 저장 → 바이트 동일: ${identical}/${files} (${pct(identical, files)})`)
console.log(`   원문과 묶인 블록: ${blocksBound}/${blocksAll} (${pct(blocksBound, blocksAll)})`)
console.log(`② 전부 새로 써도 같은 뜻: ${semantic}/${files} (${pct(semantic, files)})`)
console.log(`   가장 느린 문서: ${slowest.ms.toFixed(0)}ms — ${slowest.file} (${slowest.kb}KB)`)
console.log('\n뜻이 달라진 블록 종류:')
for (const [k, v] of [...changedByType].sort((x, y) => y[1] - x[1])) console.log(`  ${k}: ${v}`)
console.log('\n원문으로 남은 조각 (위지윅으로 못 그림):')
for (const [k, v] of [...rawKinds].sort((x, y) => y[1] - x[1]).slice(0, 25)) console.log(`  ${k}: ${v}`)
if (failures.length) {
  console.log(`\n실패 ${failures.length}건:`)
  for (const f of failures.slice(0, 15)) console.log(`  ${f.file}\n    ${f.why}`)
}
if (process.env.EXAMPLES) {
  console.log('\n예시:')
  for (const [k, ex] of examples) for (const e of ex) console.log(`--- [${k}] ${e.file}\n${e.before}`)
}
