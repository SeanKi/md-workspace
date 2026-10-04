// 디버그: 말뭉치에서 새로 쓰면 뜻이 달라지는 블록 예시를 종류별로 보여 준다
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getSchema } from '@tiptap/core'
import { parseMarkdown, writeBlock, meaning } from '@md/md-bridge'
import { buildExtensions } from '../src/extensions.js'
const schema = getSchema(buildExtensions())
const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash'])
function* walk(p) { const st = statSync(p); if (st.isFile()) { if (/\.md$/i.test(p)) yield p; return } for (const n of readdirSync(p)) if (!SKIP.has(n)) yield* walk(join(p, n)) }
const want = process.argv[2], per = 3, seen = new Map()
for (const root of process.argv.slice(3)) for (const f of walk(root)) {
  const parsed = parseMarkdown(readFileSync(f, 'utf8'))
  for (const b of parsed.blocks) {
    const t = b.json.type; if (want !== 'all' && t !== want) continue
    if ((seen.get(t) ?? 0) >= per) continue
    let md; try { md = writeBlock(schema.nodeFromJSON(b.json), parsed.style) } catch (e) { md = 'ERR ' + e.message }
    if (meaning(/[ 	]*$/.exec(b.gap)[0] + b.src) === meaning(md)) continue
    seen.set(t, (seen.get(t) ?? 0) + 1)
    console.log(`##### [${t}] ${f.slice(-50)}\n--- 원문\n${b.src.slice(0, 400)}\n--- 새로 씀\n${md.slice(0, 400)}\n`)
  }
}
