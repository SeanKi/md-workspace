import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/*
 * 본문 안에서 찾기 (Ctrl+F). 찾은 자리는 꾸밈(decoration)으로 칠하고, 지금 자리는 선택으로 옮긴다.
 *
 * 글자 노드 하나씩이 아니라 **문단(텍스트 블록) 단위**로 찾는다. "굵은 글씨" 처럼 표시가
 * 섞인 문장은 글자 노드가 쪼개져 있어서 노드마다 찾으면 걸리지 않는다.
 * 대소문자는 가리지 않는다.
 */

export const findKey = new PluginKey('mdFind')

/** 문서에서 글자를 찾는다 (대소문자 무시, 문단 단위). reveal.js 도 쓴다 */
export function searchDoc(doc, query) {
  const out = []
  if (!query) return out
  const want = query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const at = []                       // 글자 번호 → 문서 위치
    node.forEach((child, off) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) at.push(pos + 1 + off + i)
        text += child.text
      } else {
        at.push(pos + 1 + off)          // 이미지·줄바꿈 같은 것은 한 칸으로
        text += '￼'
      }
    })
    const hay = text.toLowerCase()
    for (let i = hay.indexOf(want); i >= 0; i = hay.indexOf(want, i + want.length)) {
      out.push({ from: at[i], to: at[i + want.length - 1] + 1 })
    }
    return false
  })
  return out
}

function decorate(doc, s) {
  if (!s.matches.length) return DecorationSet.empty
  return DecorationSet.create(doc, s.matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === s.index ? 'tt-find tt-find-cur' : 'tt-find' })))
}

const EMPTY = { query: '', matches: [], index: -1 }

export const findExtension = Extension.create({
  name: 'mdFind',
  addProseMirrorPlugins: () => [new Plugin({
    key: findKey,
    state: {
      init: () => ({ ...EMPTY, deco: DecorationSet.empty }),
      apply(tr, old) {
        const meta = tr.getMeta(findKey)
        if (!meta && !tr.docChanged) return old
        const query = meta && 'query' in meta ? meta.query : old.query
        const matches = meta?.query !== undefined || tr.docChanged ? searchDoc(tr.doc, query) : old.matches
        let index = meta && 'index' in meta ? meta.index : old.index
        if (meta?.query !== undefined) {
          // 새로 찾을 때는 커서 뒤의 첫 자리부터
          const from = tr.selection.from
          index = matches.findIndex((m) => m.from >= from)
          if (index < 0) index = matches.length ? 0 : -1
        }
        if (index >= matches.length) index = matches.length - 1
        const s = { query, matches, index }
        return { ...s, deco: decorate(tr.doc, s) }
      },
    },
    props: { decorations: (state) => findKey.getState(state).deco },
    // 그림 칠하기는 편집기가 그 블록을 다시 그린 **뒤에** 한다 — 바로 칠하면 다시 그리면서 지워졌다.
    // 찾기 상태가 바뀔 때와 Mermaid 그림이 새로 그려질 때(CodeBlockView 가 알린다) 다음 프레임에
    view: (v) => {
      let raf = 0
      const paint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paintDiagrams(v)) }
      window.addEventListener('md-mermaid-rendered', paint)
      return {
        update: (view, prev) => { if (findKey.getState(view.state) !== findKey.getState(prev)) paint() },
        destroy: () => { cancelAnimationFrame(raf); window.removeEventListener('md-mermaid-rendered', paint) },
      }
    },
  })],
})

export const findState = (editor) => findKey.getState(editor.state) ?? EMPTY

/** 찾을 말을 바꾼다 */
export function setQuery(editor, query) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query }))
  paintDiagrams(editor.view)      // 맞는 것이 없어도 지난 표시는 지운다
  reveal(editor)
}

/** 다음(+1) · 이전(-1) 자리로 */
export function step(editor, dir) {
  const s = findState(editor)
  if (!s.matches.length) return
  const index = (s.index + dir + s.matches.length) % s.matches.length
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { index }))
  reveal(editor)
}

/** 편집기를 담은 스크롤 상자 (`.editor-wrap`) — 본문만 굴린다. 페이지나 옆 패널은 건드리지 않는다 */
function scroller(el) {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/**
 * 찾은 자리로 굴린다. ProseMirror 의 `scrollIntoView()` 에 맡기면 **포커스가 찾기 칸에 있는 동안 굴러가지 않는다** —
 * 몇 번째인지 숫자만 바뀌고 화면은 그대로라 "엉뚱한 데를 뒤지는" 것처럼 보였다.
 * 그래서 그 자리의 좌표를 재서 본문 상자만 직접 굴린다. 이미 보이면 그대로 두고, 안 보이면 가운데쯤으로
 */
/** 그 자리가 소스를 접어 둔 Mermaid 블록 안이면 그 그림 — 소스는 화면에 없어 좌표가 0 이다 */
function diagramOf(view, pos) {
  let el
  try { el = view.domAtPos(pos).node } catch { return null }
  el = el?.nodeType === 1 ? el : el?.parentElement
  const block = el?.closest('.md-code.is-mermaid')
  if (!block || !block.querySelector('pre.md-code-hidden')) return null
  return block.querySelector('.mermaid-view')
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 지난번에 단 표시를 걷는다 — 감쌌던 글자는 원래 글자 노드로 되돌린다 */
function clearDiagramMarks(root) {
  root.querySelectorAll('rect.tt-find-rect').forEach((r) => r.remove())
  root.querySelectorAll('mark.tt-find-mark, tspan.tt-find-span').forEach((m) => {
    const p = m.parentNode
    if (!p) return
    p.replaceChild(document.createTextNode(m.textContent), m)
    p.normalize()
  })
}

/**
 * 그림 안에서 찾는 말이 든 **글자 조각만** 감싼다 (라벨 통째가 아니라). 그림 글자는 두 가지다 —
 * HTML 라벨(흐름도 대부분, foreignObject 안)은 <mark> 로, SVG 글자(순서도 등)는 <tspan> 으로 감싸고
 * 뒤에 사각형을 깐다(SVG 글자에는 배경이 없다). 감싼 것을 그림 안의 차례대로 돌려준다
 */
function markDiagram(mv, q) {
  const texts = []
  const walk = document.createTreeWalker(mv, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.data.toLowerCase().includes(q)) texts.push(n)
  const out = []
  for (const t of texts) {
    const parent = t.parentNode
    const svgText = parent.namespaceURI === SVG_NS
    const lower = t.data.toLowerCase()
    const frag = document.createDocumentFragment()
    let at = 0
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
      if (i > at) frag.append(t.data.slice(at, i))
      const m = svgText ? document.createElementNS(SVG_NS, 'tspan') : document.createElement('mark')
      m.setAttribute('class', svgText ? 'tt-find-span' : 'tt-find-mark')
      m.textContent = t.data.slice(i, i + q.length)
      frag.append(m)
      out.push(m)
      at = i + q.length
    }
    if (at < t.data.length) frag.append(t.data.slice(at))
    parent.replaceChild(frag, t)
  }
  // SVG 글자 뒤의 사각형 — 감싼 tspan 의 상자를 재서, 그 글자(<text>)와 같은 자리 · 같은 변환으로 깐다
  for (const m of out) {
    if (m.namespaceURI !== SVG_NS) continue
    const text = m.closest('text')
    if (!text) continue
    let b
    try { b = m.getBBox() } catch { continue }
    const r = document.createElementNS(SVG_NS, 'rect')
    r.setAttribute('class', 'tt-find-rect')
    r.setAttribute('x', b.x - 2); r.setAttribute('y', b.y - 1)
    r.setAttribute('width', b.width + 4); r.setAttribute('height', b.height + 2)
    r.setAttribute('rx', 2)
    if (text.getAttribute('transform')) r.setAttribute('transform', text.getAttribute('transform'))
    text.parentNode.insertBefore(r, text)
    m._rect = r
  }
  return out
}

/** 감싼 것 하나를 "지금 자리" 로 — 반전 (어두운 바탕 · 흰 글자) */
function setCurrent(m) {
  m.classList.add('cur')
  m._rect?.classList.add('cur')
}

/*
 * Mermaid 그림 안의 맞는 글자를 칠한다. 찾기는 문서(= 그림의 소스)에서 하지만, 소스를 접어 두면 보이는 것은
 * 그림뿐이라 꾸밈(decoration)이 화면에 나타나지 않는다. 그림 안의 그 글자만 감싸 노랗게 칠하고,
 * 지금 자리는 **반전**해서 보인다. 지금 자리가 그 그림의 몇 번째인지는 소스에서 그 블록 안의 몇 번째 맞음인지로 고른다
 */
function paintDiagrams(view) {
  const s = findKey.getState(view.state)
  clearDiagramMarks(view.dom)
  const q = (s?.query ?? '').toLowerCase()
  if (!q) return
  const curMatch = s.matches[s.index]
  const cur = curMatch ? diagramOf(view, curMatch.from) : null
  // 같은 그림의 맞음들 중 지금 것이 몇 번째인가
  const k = cur ? s.matches.slice(0, s.index).filter((m) => diagramOf(view, m.from) === cur).length : -1
  for (const mv of view.dom.querySelectorAll('.mermaid-view')) {
    const marks = markDiagram(mv, q)
    if (mv === cur && marks.length) setCurrent(marks[Math.min(k, marks.length - 1)])
  }
}

function scrollToMatch(view, pos) {
  const box = scroller(view.dom)
  if (!box) return
  let c
  const pic = diagramOf(view, pos)
  if (pic) c = (pic.querySelector('.tt-find-mark.cur, .tt-find-span.cur') ?? pic).getBoundingClientRect()
  else try { c = view.coordsAtPos(pos) } catch { return }
  const r = box.getBoundingClientRect()
  // 위쪽에는 붙어 있는 도구 줄(sticky)이 가린다 — 그만큼은 안 보이는 것으로 친다
  const bar = box.querySelector('.tt-toolbar')
  const top = r.top + (bar ? bar.getBoundingClientRect().height : 0) + 8
  if (c.top >= top && c.bottom <= r.bottom - 8) return
  box.scrollTop += c.top - (r.top + box.clientHeight / 2)
}

function reveal(editor) {
  const s = findState(editor)
  const m = s.matches[s.index]
  if (!m) return
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)))
  paintDiagrams(editor.view)
  scrollToMatch(editor.view, m.from)
}

export function clearFind(editor) {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '' }))
  paintDiagrams(editor.view)
}
