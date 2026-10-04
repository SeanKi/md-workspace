// 디버그: 조각 하나를 읽어 PM JSON 과 새로 쓴 결과를 보여 준다
import { getSchema } from '@tiptap/core'
import { parseMarkdown, parseTree, writeBlock } from '@md/md-bridge'
import { buildExtensions } from '../src/extensions.js'
const schema = getSchema(buildExtensions())
const src = process.argv[2].replace(/\n/g, '\n')
const p = parseMarkdown(src)
for (const b of p.blocks) {
  if (process.env.TREE) console.log(JSON.stringify(parseTree(b.src).children, (k, v) => (k === 'position' ? undefined : v)))
  console.log(JSON.stringify(b.json))
  const node = schema.nodeFromJSON(b.json)
  console.log('PM:', node.toString())
  console.log('OUT:\n' + writeBlock(node, p.style))
}
