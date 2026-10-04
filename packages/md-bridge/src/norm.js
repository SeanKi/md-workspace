import { parseTree } from './parse.js'

/** 뜻 비교용 mdast — 위치·목록 간격 표시는 빼고, 이웃한 글자는 합친다 */
export function norm(node) {
  if (Array.isArray(node)) {
    const out = []
    for (const n of node.map(norm)) {
      const last = out[out.length - 1]
      if (n.type === 'text' && last?.type === 'text') last.value += n.value
      else out.push(n)
    }
    return out
  }
  const o = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'position' || k === 'data' || k === 'spread' || v == null) continue
    o[k] = k === 'children' ? norm(v) : v
  }
  if (typeof o.value === 'string') o.value = o.value.replace(/\r\n/g, '\n')
  if (o.type === 'html') o.value = o.value.trim()
  return o
}

export const meaning = (md) => JSON.stringify(norm(parseTree(md).children))

/** 직렬화기가 조심스럽게 붙이는 이스케이프 중 우리가 떼 보는 것들 */
const CANDIDATE = /\\([~_[\]*&|#<>!`+-])/g
const MAX_TRIES = 40

/**
 * **뜻이 같다는 것이 증명될 때만** 백슬래시를 뗀다.
 *
 * mdast-util-to-markdown 은 문맥을 다 보지 않고 안전한 쪽으로 이스케이프한다.
 * `A_B` → `A\_B`, `[[위키링크]]` → `\[\[위키링크]]`, `p.62~65` → `p.62\~65`.
 * 규칙을 손으로 짜는 대신 하나씩 떼어 보고 다시 읽어 같으면 받아들인다.
 * 고친 블록에만 쓰므로 비용은 블록 크기에 비례한다.
 */
export function unescapeMinimal(md) {
  const target = meaning(md)
  let cur = md
  let tries = 0
  let from = 0
  for (;;) {
    CANDIDATE.lastIndex = from
    const m = CANDIDATE.exec(cur)
    if (!m || ++tries > MAX_TRIES) return cur
    const trial = cur.slice(0, m.index) + cur.slice(m.index + 1)
    if (meaning(trial) === target) { cur = trial; from = m.index + 1 }
    else from = m.index + 2
  }
}
