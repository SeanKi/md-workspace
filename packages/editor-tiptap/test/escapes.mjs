// 고친 문단이 어떻게 다시 쓰이는지 — 이스케이프 확인용
import { getSchema } from '@tiptap/core'
import { parseMarkdown, writeBlock } from '@md/md-bridge'
import { buildExtensions } from '../src/extensions.js'
const schema = getSchema(buildExtensions())
const cases = ['p.62~65', 'A_B 와 snake_case_name', 'drag&drop &amp; ok', 'A <- B, p<0.05', '1. 아님', '# 아님', 'a*b*c', '<span style="color:#e11d48">빨강</span> 글자', '<u>밑줄</u>과 <b>굵게</b>', 'x  \ny', 'a\\nb', '| 표 | 아님 |', '[[위키링크]]', '<details>요약</details>', '`code` **굵은 `코드`**', '- [ ] 할일\n- 그냥\n- [x] 끝']
for (const c of cases) {
  const p = parseMarkdown(c)
  const out = p.blocks.map((b) => writeBlock(schema.nodeFromJSON(b.json), p.style)).join('\n\n')
  console.log((out === c ? 'same ' : 'DIFF ') + JSON.stringify(c) + (out === c ? '' : ' -> ' + JSON.stringify(out)))
}
