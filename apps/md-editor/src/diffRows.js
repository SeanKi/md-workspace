/**
 * 두 글을 **좌우로 짝지은 줄**로 바꾼다. 그리는 일은 `DiffView.jsx` 가 한다.
 *
 * 왼쪽은 내가 고친 것, 오른쪽은 파일 원본. 같은 줄은 같은 높이에 놓고,
 * 한쪽에만 있는 줄은 반대쪽을 비워 둔다 — 그래야 눈이 가로로 훑으며 비교할 수 있다.
 */

import { diffLines } from 'diff'

export const CONTEXT = 2   // 바뀐 줄 앞뒤로 남길 줄 수

const split = (v) => v.replace(/\n$/, '').split('\n')

/**
 * 좌우 두 칸으로 줄을 맞춘다.
 *
 * 왼쪽은 **내가 고친 것**, 오른쪽은 **파일 원본**. 같은 줄은 같은 높이에 놓고,
 * 한쪽에만 있는 줄은 반대쪽을 비워 둔다 — 그래야 눈이 가로로 훑으며 비교할 수 있다.
 *
 * 지운 덩어리 바로 뒤에 더한 덩어리가 오면 **한 줄씩 짝지어** 세운다.
 * 그게 사람이 말하는 "고친 줄" 이다.
 */
export function buildRows(mine, theirs) {
  const parts = diffLines(mine ?? '', theirs ?? '')
  const rows = []
  let ln = 1
  let rn = 1
  let added = 0
  let removed = 0

  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]

    if (!p.added && !p.removed) {
      const lines = split(p.value)
      // 그대로인 부분은 앞뒤 문맥만 남기고 접는다. 전부 늘어놓으면 뭐가 달라졌는지 안 보인다
      const head = i === 0 ? [] : lines.slice(0, CONTEXT)
      const tail = i === parts.length - 1 ? [] : lines.slice(-CONTEXT)
      let hidden = lines.length - head.length - tail.length
      // 몇 줄 안 되면 접지 않는다 — "1줄 생략" 은 그 줄을 보여주는 것보다 번거롭다
      if (hidden > 0 && hidden <= CONTEXT) {
        lines.forEach((t) => rows.push({ kind: 'same', left: t, right: t, ln: ln++, rn: rn++ }))
        continue
      }

      head.forEach((t) => rows.push({ kind: 'same', left: t, right: t, ln: ln++, rn: rn++ }))
      if (hidden > 0) {
        rows.push({ kind: 'gap', text: `⋯ 같은 ${hidden}줄 생략` })
        ln += hidden
        rn += hidden
      }
      tail.forEach((t) => rows.push({ kind: 'same', left: t, right: t, ln: ln++, rn: rn++ }))
      continue
    }

    let L = []
    let R = []
    if (p.removed) {
      L = split(p.value)
      if (parts[i + 1]?.added) { R = split(parts[i + 1].value); i += 1 }
    } else {
      R = split(p.value)
    }
    removed += L.length
    added += R.length

    for (let k = 0; k < Math.max(L.length, R.length); k += 1) {
      rows.push({
        kind: 'change',
        left: L[k] ?? null,
        right: R[k] ?? null,
        ln: k < L.length ? ln++ : null,
        rn: k < R.length ? rn++ : null,
      })
    }
  }
  return { rows, added, removed }
}
