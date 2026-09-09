/**
 * 화면이 멎는 상황을 잡아 기록한다 (`md-core/src/diag.rs` 가 파일로 적는다).
 *
 * 두 가지를 본다.
 *
 *   1. **멈춤** — 250ms 마다 뛰는 심장 박동이 늦으면 그만큼 화면이 멎어 있었다는 뜻이다.
 *      브라우저의 타이머는 메인 스레드가 막히면 함께 밀리므로 이걸로 잰다.
 *   2. **느린 호출** — Rust 커맨드가 얼마나 걸렸는지. 멎은 시각과 나란히 놓으면
 *      "무엇 때문에 멎었나" 가 바로 읽힌다.
 *
 * 기록은 모아서 쓴다. 한 줄마다 파일을 여닫으면 그게 또 느려진다.
 */

import { useEffect, useState } from 'react'
import { invoke as rawInvoke } from '@tauri-apps/api/core'
import { isTauri } from './tauriBridge.js'
import { startImeWatch } from './imeWatch.js'

const BEAT_MS = 250          // 심장 박동 간격
const STALL_MS = 600         // 이보다 늦으면 "멎었다" 로 본다
const SLOW_MS = 300          // 이보다 오래 걸린 커맨드는 적어 둔다
const BUSY_MS = 400          // 이보다 오래 걸리면 "무엇을 하는 중" 이라고 화면에 말한다
const FLUSH_MS = 3000
const MAX_BUFFER = 200

let app = 'app'
let buffer = []
let flushTimer = 0
let last = { name: '(없음)', at: 0 }

const stamp = () => new Date().toTimeString().slice(0, 8)

function push(line) {
  buffer.push(`${stamp()} ${line}`)
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
}

export function flush() {
  clearTimeout(flushTimer)
  flushTimer = 0
  if (buffer.length === 0 || !isTauri) { buffer = []; return }
  const lines = buffer
  buffer = []
  rawInvoke('log_write', { app, lines }).catch(() => { /* 로그 때문에 앱이 멈출 수는 없다 */ })
}

/** 사람이 남기고 싶은 한 줄 */
export const note = (text) => push(text)

/* ---------- 오래 걸리는 일을 화면에 말해 주기 ---------- */

// 커맨드 이름을 사람 말로. 없는 것은 굳이 알리지 않는다(잡음이다)
const BUSY_NAME = {
  read_file: '문서 여는 중', write_file: '저장 중',
  search_repo: '저장소 찾는 중', read_dir: '폴더 읽는 중',
  git_commit: '커밋 중', git_init: 'git 저장소 만드는 중', git_status: 'git 상태 보는 중',
  save_pdf: 'PDF 만드는 중', save_binary_b64: '이미지 저장 중',
  delete_path: '휴지통으로 보내는 중', rename_path: '이름 바꾸는 중',
}

const running = new Map()      // id → { label, at }
let busyListeners = []
let busyTimer = 0
let seq = 0

function busyText() {
  const now = Date.now()
  let oldest = null
  for (const r of running.values()) {
    if (now - r.at < BUSY_MS) continue
    if (!oldest || r.at < oldest.at) oldest = r
  }
  if (!oldest) return ''
  const sec = Math.round((now - oldest.at) / 1000)
  return sec >= 1 ? `${oldest.label}… ${sec}초째` : `${oldest.label}…`
}

function tellBusy() {
  const text = busyText()
  busyListeners.forEach((fn) => fn(text))
  const need = running.size > 0
  if (need && !busyTimer) busyTimer = setInterval(tellBusy, 500)
  if (!need && busyTimer) { clearInterval(busyTimer); busyTimer = 0 }
}

/**
 * 지금 오래 걸리고 있는 일. 없으면 빈 글자.
 * 창이 멎은 것처럼 보일 때 **무엇을 하는 중인지, 몇 초째인지** 알려 주려고 있다.
 */
export function useBusy() {
  const [text, setText] = useState('')
  useEffect(() => {
    busyListeners.push(setText)
    return () => { busyListeners = busyListeners.filter((f) => f !== setText) }
  }, [])
  return text
}

/**
 * Rust 커맨드 호출. `invoke` 대신 이것을 쓴다.
 * 오래 걸린 것만 적는다 — 전부 적으면 로그가 잡음이 된다.
 */
export async function invoke(name, args) {
  const t0 = performance.now()
  last = { name, at: Date.now() }

  const label = BUSY_NAME[name]
  const id = label ? ++seq : 0
  if (id) { running.set(id, { label, at: Date.now() }); tellBusy() }

  try {
    return await rawInvoke(name, args)
  } catch (e) {
    push(`오류  ${name} — ${String(e).slice(0, 200)}`)
    throw e
  } finally {
    if (id) { running.delete(id); tellBusy() }
    const ms = Math.round(performance.now() - t0)
    if (ms >= SLOW_MS) push(`느림  ${name} ${ms}ms${argHint(args)}`)
  }
}

/** 어떤 파일이었는지 정도만. 문서 내용을 로그에 흘리면 안 된다 */
function argHint(args) {
  const p = args?.path ?? args?.root ?? args?.from
  return p ? ` — ${String(p).slice(-60)}` : ''
}

/**
 * 멈춤 감시를 켠다. 앱이 뜰 때 한 번 부른다.
 * @param name 로그 파일 이름에 쓸 앱 이름
 */
export function startDiag(name) {
  app = name
  if (!isTauri) return () => {}

  let prev = performance.now()
  const beat = setInterval(() => {
    const now = performance.now()
    const late = Math.round(now - prev - BEAT_MS)
    prev = now
    if (late < STALL_MS) return
    // 멎기 직전에 무엇을 부르고 있었는지 함께 적어야 원인이 읽힌다
    const ago = last.at ? `${Math.round((Date.now() - last.at) / 100) / 10}초 전` : '—'
    push(`멎음  ${late}ms · 직전 호출 ${last.name} (${ago})`)
    flush()
  }, BEAT_MS)

  const stopIme = startImeWatch()   // 한글 조합이 제때 그려지는지도 함께 본다

  const onError = (e) => { push(`예외  ${e.message ?? e.reason ?? e}`); flush() }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onError)
  window.addEventListener('beforeunload', flush)

  push(`시작  ${name}`)
  return () => {
    clearInterval(beat)
    stopIme()
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onError)
    flush()
  }
}

/** 기록이 쌓이는 폴더 (화면에 알려 주려고) */
export const logDir = () => (isTauri ? rawInvoke('log_dir') : Promise.resolve(''))

/** 오늘 기록의 마지막 몇 줄 */
export const logTail = (count = 40) => (
  isTauri ? rawInvoke('log_tail', { app, count }) : Promise.resolve([])
)
