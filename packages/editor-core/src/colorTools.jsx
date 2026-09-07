/**
 * 글자색 · 배경색 단추. 툴바에 붙는다.
 *
 * 마크다운에는 색이라는 개념이 없다. 그래서 **인라인 HTML** 로 넣는다 —
 * `<span style="color:#e11d48">글자</span>`. MDXEditor 는 이런 요소를
 * `GenericHTMLNode` 로 읽고 그대로 다시 써 주므로 왕복이 닫힌다.
 *
 * VS Code 미리보기·Obsidian 은 그대로 보여준다. **GitHub 은 style 을 지운다** —
 * 색은 사라지고 글자만 남는다(내용이 깨지지는 않는다).
 *
 * 이미 색이 걸린 자리에 다시 칠하면 **겹치지 않고 그 span 을 고친다.**
 * 겹치기 시작하면 `<span><span><span>` 이 쌓여 문서가 금세 지저분해진다.
 */

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ButtonWithTooltip, activeEditor$ } from '@mdxeditor/editor'
import { useCellValue } from '@mdxeditor/gurx'
import { $createGenericHTMLNode, $isGenericHTMLNode } from '@mdxeditor/editor'
import { $getSelection, $isRangeSelection, $isTextNode } from 'lexical'
import { $findMatchingParent } from '@lexical/utils'

const TEXT_COLORS = [
  ['#e11d48', '빨강'], ['#ea580c', '주황'], ['#ca8a04', '노랑'],
  ['#16a34a', '초록'], ['#2563eb', '파랑'], ['#7c3aed', '보라'],
  ['#0f172a', '검정'], ['#6b7280', '회색'],
]

const BACK_COLORS = [
  ['#fef08a', '노랑'], ['#bbf7d0', '초록'], ['#bfdbfe', '파랑'],
  ['#fbcfe8', '분홍'], ['#fed7aa', '주황'], ['#e5e7eb', '회색'],
]

/* ---------- 스타일 문자열 다루기 ---------- */

const parseStyle = (s) => Object.fromEntries(
  (s ?? '').split(';').map((x) => x.split(':')).filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]),
)

const buildStyle = (o) => Object.entries(o)
  .filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(';')

/** 우리가 만든 색 span 인가 (남의 `<span>` 은 건드리지 않는다) */
const isColorSpan = (n) => (
  $isGenericHTMLNode(n) && n.getTag() === 'span' && /color/.test(n.getStyle() ?? '')
)

const attrs = (style) => [{ type: 'mdxJsxAttribute', name: 'style', value: style }]

/* ---------- 칠하기 ---------- */

/**
 * 고른 자리에 색을 입힌다. `prop` 은 `color`(글자) 또는 `background-color`.
 * `value` 가 없으면 그 색만 걷어낸다.
 */
function apply(editor, prop, value) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || sel.isCollapsed()) return

    const nodes = sel.extract().filter($isTextNode)
    if (nodes.length === 0) return

    // 이미 색 span 안이라면 새로 감싸지 않고 그 span 을 고친다
    const wrappers = new Set()
    for (const n of nodes) {
      const w = $findMatchingParent(n, isColorSpan)
      if (w) wrappers.add(w)
    }
    const allInside = wrappers.size === 1
      && nodes.every((n) => $findMatchingParent(n, isColorSpan) === [...wrappers][0])

    if (allInside) {
      const w = [...wrappers][0]
      const style = { ...parseStyle(w.getStyle()), [prop]: value }
      const next = buildStyle(style)
      if (next) { w.updateAttributes(attrs(next)); return }
      // 색이 하나도 안 남았다 — 껍데기를 벗긴다
      const kids = w.getChildren()
      kids.forEach((k) => w.insertBefore(k))
      w.remove()
      return
    }

    if (!value) return   // 감쌀 것도 없는데 지울 것도 없다

    // 부모가 같은 것끼리 묶어 한 번씩만 감싼다. 글자마다 감싸면 span 이 우수수 생긴다
    const groups = []
    for (const n of nodes) {
      const last = groups[groups.length - 1]
      if (last && last[0].getParent()?.is(n.getParent())) last.push(n)
      else groups.push([n])
    }
    for (const g of groups) {
      const span = $createGenericHTMLNode('span', 'mdxJsxTextElement', attrs(`${prop}:${value}`))
      g[0].insertBefore(span)
      g.forEach((n) => span.append(n))
    }
  })
}

/** 고른 자리의 색을 통째로 벗긴다 */
function clearAll(editor) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return
    const seen = new Set()
    for (const n of sel.extract()) {
      const w = $findMatchingParent(n, isColorSpan)
      if (w && !seen.has(w.getKey())) { seen.add(w.getKey()); w.getChildren().forEach((k) => w.insertBefore(k)); w.remove() }
    }
  })
}

/* ---------- 화면 ---------- */

/**
 * 색판. **본문 맨 위(portal)에 띄운다** — 툴바 안에 그리면 툴바의 넘침 처리에
 * 잘려서 아래쪽 색이 보이지 않는다. 자리는 단추의 화면 좌표로 잡는다.
 */
function Palette({ at, colors, onPick, onClear, onClose }) {
  const ref = useRef(null)

  // 화면 밖으로 나가지 않게 접어 넣는다
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 4) el.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`
    if (r.bottom > window.innerHeight - 4) el.style.top = `${Math.max(4, at.top - r.height - 6)}px`
  }, [at])

  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  return createPortal(
    <div className="color-pop" ref={ref} style={{ left: at.left, top: at.top }}>
      {colors.map(([c, name]) => (
        <button key={c} type="button" title={name} style={{ background: c }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(c); onClose() }} />
      ))}
      <button type="button" className="color-clear" title="색 지우기"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onClear(); onClose() }}>지우기</button>
    </div>,
    document.body,
  )
}

function ColorButton({ title, colors, prop, glyph, bar }) {
  const editor = useCellValue(activeEditor$)
  const hostRef = useRef(null)
  const [at, setAt] = useState(null)

  const toggle = () => {
    if (at) { setAt(null); return }
    const r = hostRef.current?.getBoundingClientRect()
    setAt(r ? { left: r.left, top: r.bottom + 4 } : { left: 8, top: 8 })
  }

  return (
    <span className="color-tool" ref={hostRef}>
      <ButtonWithTooltip title={title} onClick={toggle}>
        <span className="color-glyph">
          {glyph}
          <i style={{ background: bar }} />
        </span>
      </ButtonWithTooltip>
      {at && (
        <Palette
          at={at}
          colors={colors}
          onPick={(c) => editor && apply(editor, prop, c)}
          onClear={() => editor && apply(editor, prop, null)}
          onClose={() => setAt(null)}
        />
      )}
    </span>
  )
}

/** 글자색 */
export const TextColor = () => (
  <ColorButton title="글자색" colors={TEXT_COLORS} prop="color" glyph="가" bar="#e11d48" />
)

/** 배경색(형광펜) */
export const BackColor = () => (
  <ColorButton title="배경색" colors={BACK_COLORS} prop="background-color" glyph="가" bar="#fef08a" />
)

export { clearAll as clearColors }
