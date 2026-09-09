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

/** 조합 한 단계가 이보다 늦게 그려지면 적는다 */
const SLOW_MS = 150
/** Lexical 이 길을 가르는 값 (`ANDROID_COMPOSITION_LATENCY`) */
const LEXICAL_BRANCH_MS = 30

let users = 0
let lastKeyDown = 0
let startedAt = 0
let steps = 0
let missed = 0
let slowest = 0

const onKeyDown = (e) => { if (e.isComposing || e.keyCode === 229) lastKeyDown = performance.now() }

function onStart() {
  startedAt = performance.now()
  steps = 0
  missed = 0
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
    if (!visible(data)) missed += 1
  })
}

/** 조합 중인 글자가 지금 화면(DOM)에 있는가 */
function visible(data) {
  const sel = window.getSelection?.()
  const node = sel?.anchorNode
  const text = node?.nodeType === 3 ? node.data : node?.textContent
  if (typeof text === 'string' && text.includes(data)) return true
  // 선택이 다른 곳을 가리키는 경우도 있어 편집 중인 상자까지 한 번 더 본다
  const box = document.activeElement?.closest?.('[contenteditable="true"]')
  return !!box && box.textContent.includes(data)
}

function onEnd() {
  const total = Math.round(performance.now() - startedAt)
  if (missed > 0) {
    note(`조합  ${steps}단계 중 ${missed}단계가 화면에 안 나타남 · 총 ${total}ms · 가장 느린 단계 ${slowest}ms`)
  } else if (slowest >= SLOW_MS) {
    note(`조합  느림 — ${steps}단계 · 총 ${total}ms · 가장 느린 단계 ${slowest}ms`)
  }
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
