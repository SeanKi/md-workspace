/**
 * 표에서 마우스를 끌어 여러 셀을 고르고 복사한다.
 *
 * MDXEditor 의 표는 **셀 안쪽만** 각각 독립된 lexical 편집기다
 * (`plugins/table/TableEditor.js` — 셀마다 ContentEditable 을 따로 만든다).
 * 그래서 브라우저의 선택 영역이 셀 경계를 넘지 못한다. 그건 못 고친다.
 *
 * 그런데 **바깥은 진짜 `<table>`·`<tr>`·`<td>` 다.** 그러니 브라우저 선택을 고칠 게
 * 아니라 **선택을 우리가 직접 그리면 된다.** 표 플러그인을 갈아엎지 않는 유일한 길이다.
 *
 * 규칙
 *  - 한 셀 안에서만 끄는 동안은 건드리지 않는다 — 평소의 글자 선택이 그대로 산다
 *  - 다른 셀로 넘어가는 순간 셀 범위 선택으로 바뀐다
 *  - Ctrl+C 는 두 가지를 함께 담는다
 *      text/plain  탭 구분 → 엑셀·메모장
 *      text/html   표      → 엑셀은 셀로 나눠 받고, 이 편집기에 붙이면 표가 된다
 *                            (저장하면 `| 값 | 값 |` 마크다운 표로 나간다)
 *
 * 놓을 자리는 `elementFromPoint` 로 찾는다 — 트리 끌기(`useTreeDrag.js`)와 같은 방식이다.
 */

import { useEffect } from 'react'

const SEL_CLASS = 'md-cell-sel'
const DRAG_CLASS = 'md-cells-dragging'

/* ---------- 표 격자 읽기 ---------- */

/** 진짜 내용 셀만. 도구 칸(행 추가·열 추가 단추)은 표가 아니다 */
const realCells = (row) => [...row.cells].filter((c) => !c.hasAttribute('data-tool-cell'))

const bodyRows = (table) => (table.tBodies[0] ? [...table.tBodies[0].rows] : [])

/** 이 셀이 어느 표의 몇 행 몇 열인가. 내용 셀이 아니면 null */
function locate(node) {
  const cell = node?.closest?.('td, th')
  if (!cell || cell.hasAttribute('data-tool-cell')) return null
  const row = cell.parentElement
  const table = cell.closest('table')
  if (!table || row?.parentElement !== table.tBodies[0]) return null
  const r = bodyRows(table).indexOf(row)
  const c = realCells(row).indexOf(cell)
  return r < 0 || c < 0 ? null : { table, r, c }
}

/** 사각 범위 안의 셀들을 행 단위로 */
function cellsIn(range) {
  const { table, r1, c1, r2, c2 } = range
  const rows = bodyRows(table)
  const out = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
    const cells = realCells(rows[r] ?? { cells: [] })
    const line = []
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) {
      if (cells[c]) line.push(cells[c])
    }
    if (line.length) out.push(line)
  }
  return out
}

/* ---------- 클립보드 ---------- */

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 탭·줄바꿈·따옴표가 든 칸은 감싼다. 그래야 엑셀이 한 칸으로 받는다 */
const tsvCell = (s) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

function build(grid) {
  const text = grid.map((row) => row.map(tsvCell).join('\t')).join('\n')
  const html = `<table>${grid.map((row) => (
    `<tr>${row.map((c) => `<td>${escHtml(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`
  )).join('')}</table>`
  return { text, html }
}

/**
 * 클립보드에 두 형식을 함께 넣는다.
 * `clipboard.write` 가 막히는 경우(포커스를 잃었을 때 등)를 위해 옛 방식도 남긴다 —
 * 숨긴 곳에 표를 그려 두고 그대로 복사하면 형식이 살아서 간다.
 */
async function writeBoth(text, html) {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })])
    return true
  } catch { /* 아래에서 한 번 더 */ }

  const box = document.createElement('div')
  box.contentEditable = 'true'
  box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  box.innerHTML = html
  document.body.appendChild(box)
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(box)
  sel.removeAllRanges()
  sel.addRange(range)
  const ok = document.execCommand('copy')
  sel.removeAllRanges()
  box.remove()
  return ok
}

/* ---------- 선택 상태 ---------- */

let anchor = null      // { table, r, c } — 누른 자리
let range = null       // { table, r1, c1, r2, c2 } — 셀을 넘어간 뒤에만 생긴다
let painted = []       // 지금 색칠해 둔 셀들
let hintEl = null

function hint(msg) {
  if (!msg) { hintEl?.remove(); hintEl = null; return }
  if (!hintEl) {
    hintEl = document.createElement('div')
    hintEl.className = 'md-cell-hint'
    document.body.appendChild(hintEl)
  }
  hintEl.textContent = msg
}

function paint() {
  painted.forEach((c) => c.classList.remove(SEL_CLASS))
  painted = range ? cellsIn(range).flat() : []
  painted.forEach((c) => c.classList.add(SEL_CLASS))
}

function clear() {
  range = null
  paint()
  hint('')
  document.querySelector(`.${DRAG_CLASS}`)?.classList.remove(DRAG_CLASS)
}

/* ---------- 손짓 ---------- */

function onPointerDown(e) {
  if (e.button !== 0) return
  clear()
  anchor = locate(e.target)
}

function onPointerMove(e) {
  if (!anchor || e.buttons !== 1) return
  const at = locate(document.elementFromPoint(e.clientX, e.clientY))
  if (!at || at.table !== anchor.table) return
  if (at.r === anchor.r && at.c === anchor.c && !range) return   // 아직 한 칸 — 글자 선택이다

  range = { table: anchor.table, r1: anchor.r, c1: anchor.c, r2: at.r, c2: at.c }
  anchor.table.classList.add(DRAG_CLASS)     // 끄는 동안 글자가 딸려 선택되지 않게
  window.getSelection()?.removeAllRanges()
  paint()
  const rows = Math.abs(at.r - anchor.r) + 1
  const cols = Math.abs(at.c - anchor.c) + 1
  hint(`${rows}×${cols} 셀 — Ctrl+C 로 복사`)
}

function onPointerUp() {
  anchor = null
  document.querySelector(`.${DRAG_CLASS}`)?.classList.remove(DRAG_CLASS)
}

async function onKeyDown(e) {
  if (e.key === 'Escape' && range) { clear(); return }
  const copyKey = (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C' || e.key === 'Insert')
  if (!copyKey || !range) return

  e.preventDefault()
  e.stopPropagation()
  // 편집기가 넣은 줄바꿈 없는 공백은 붙여넣는 쪽에서 이물질이다
  const grid = cellsIn(range).map((row) => row.map((c) => c.innerText.replace(/\u00a0/g, ' ').trim()))
  const { text, html } = build(grid)
  const ok = await writeBoth(text, html)
  const said = ok ? `${grid.length}×${grid[0]?.length ?? 0} 셀을 복사했습니다` : '복사하지 못했습니다'
  hint(said)
  setTimeout(() => { if (hintEl?.textContent === said) hint('') }, 1600)
}

/* ---------- 설치 ---------- */

let users = 0

/** 표 셀 끌어 고르기를 켠다. 여러 편집기가 있어도 듣는 자리는 하나면 된다 */
export function useTableCellSelect() {
  useEffect(() => {
    users += 1
    if (users === 1) {
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('pointerup', onPointerUp, true)
      document.addEventListener('keydown', onKeyDown, true)
    }
    return () => {
      users -= 1
      if (users > 0) return
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('keydown', onKeyDown, true)
      clear()
    }
  }, [])
}
