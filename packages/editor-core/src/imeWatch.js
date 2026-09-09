/**
 * 한글 조합이 화면에 제때 나타나는지 지켜본다.
 *
 * "가끔 조합 글자가 바로 안 보인다" 는 **재현이 안 된다.** 조합 이벤트를 흉내 내
 * 다섯 자리에서 시험해도 늘 정상이었다. 되다 안 되다 하는 것이면 무언가 **그때의
 * 상황**에 달렸다는 뜻이고, 그건 일어난 자리에서만 알 수 있다.
 *
 * 그래서 세 가지를 적는다.
 *
 *   1. 키를 누른 뒤 조합이 시작되기까지 걸린 시간
 *      — Lexical 은 이 값이 30ms 를 넘느냐로 **다른 길을 간다**(`$handleCompositionStart`).
 *        앱이 바쁘면 이 값이 커지므로 "되다 안 되다" 의 후보다
 *   2. 조합 한 단계가 화면에 그려지기까지 걸린 시간
 *   3. **그 글자가 실제로 DOM 에 나타났는가** — 다음 프레임에 확인한다.
 *      안 나타났으면 그게 바로 사용자가 겪는 그 증상이다
 *
 * 정상일 때는 아무것도 적지 않는다. 로그는 이상한 순간만 담아야 쓸모가 있다.
 */

import { note } from './diag.js'

/** 조합 한 단계가 이보다 늦게 그려지면 적는다. 사람이 느끼는 문턱에 맞춘다 */
const SLOW_MS = 80
/** Lexical 이 길을 가르는 값 (`ANDROID_COMPOSITION_LATENCY`) */
const LEXICAL_BRANCH_MS = 30

let users = 0
let lastKeyDown = 0
let startedAt = 0
let steps = 0
let missed = 0
let unknown = 0
let slowest = 0

const onKeyDown = (e) => { if (e.isComposing || e.keyCode === 229) lastKeyDown = performance.now() }

function onStart() {
  startedAt = performance.now()
  steps = 0
  missed = 0
  unknown = 0
  slowest = 0
  const gap = Math.round(startedAt - lastKeyDown)
  // 30ms 를 넘으면 Lexical 이 다른 길을 간다. 그 사실만 적어 둔다
  if (lastKeyDown && gap > LEXICAL_BRANCH_MS) note(`조합  시작이 ${gap}ms 늦음 (30ms 넘으면 Lexical 이 다른 길로 간다)`)
}

function onUpdate(e) {
  const data = e.data
  if (!data) return
  steps += 1
  const t0 = performance.now()

  // 다음 프레임에 **실제로 그려졌는지** 본다
  requestAnimationFrame(() => {
    const ms = Math.round(performance.now() - t0)
    if (ms > slowest) slowest = ms
    const seen = visible(data)
    if (seen === false) missed += 1
    else if (seen === null) unknown += 1
  })
}

/**
 * 조합 중인 글자가 **커서 자리에** 있는가.
 *
 * 처음에는 편집 상자 전체에서 그 글자를 찾았는데, 그러면 한글 문서에서는 '하' 같은
 * 글자가 어딘가엔 늘 있어서 **거의 항상 통과**했다. 그래서 아무것도 못 잡았다.
 * 커서 바로 앞의 글자와 정확히 대 본다.
 *
 * @returns true 보임 · false 안 보임 · null 판단 못 함(선택이 글자 위가 아니다)
 */
function visible(data) {
  const sel = window.getSelection?.()
  const node = sel?.anchorNode
  if (!node || node.nodeType !== 3) return null
  const off = sel.anchorOffset
  return node.data.slice(Math.max(0, off - data.length), off) === data
}

/** 지금 편집 중인 문서가 몇 글자인가 (크기와 느림을 견주려고) */
function docSize() {
  const box = document.activeElement?.closest?.('[contenteditable="true"]')
  return box ? Math.round(box.textContent.length / 1000) : 0
}

function onEnd() {
  const total = Math.round(performance.now() - startedAt)
  const where = `${steps}단계 · 총 ${total}ms · 가장 느린 단계 ${slowest}ms · 문서 ${docSize()}천 자`
  if (missed > 0) note(`조합  ${missed}단계가 커서 자리에 안 나타남 — ${where}`)
  else if (slowest >= SLOW_MS) note(`조합  느림 — ${where}`)
  else if (unknown === steps && steps > 0) note(`조합  판단 못 함(선택이 글자 위가 아님) — ${where}`)
  steps = 0
}

/** 조합 지켜보기를 켠다. 여러 편집기가 있어도 듣는 자리는 하나면 된다 */
export function startImeWatch() {
  users += 1
  if (users > 1) return () => { users -= 1 }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('compositionstart', onStart, true)
  document.addEventListener('compositionupdate', onUpdate, true)
  document.addEventListener('compositionend', onEnd, true)

  return () => {
    users -= 1
    if (users > 0) return
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('compositionstart', onStart, true)
    document.removeEventListener('compositionupdate', onUpdate, true)
    document.removeEventListener('compositionend', onEnd, true)
  }
}
