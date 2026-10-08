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
  })],
})

export const findState = (editor) => findKey.getState(editor.state) ?? EMPTY

/** 찾을 말을 바꾼다 */
export function setQuery(editor, query) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query }))
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
function scrollToMatch(view, pos) {
  const box = scroller(view.dom)
  if (!box) return
  let c
  try { c = view.coordsAtPos(pos) } catch { return }
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
  scrollToMatch(editor.view, m.from)
}

export function clearFind(editor) {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '' }))
}
