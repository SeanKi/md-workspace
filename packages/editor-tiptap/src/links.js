import { followHref, resolveHref } from '@md/editor-core/src/linkNav.js'
import { followWiki } from './wikilinks.js'
import { revealIn } from './reveal.js'

const OPENABLE = /\.(md|markdown|mdx|txt)$/i

/**
 * 링크를 따라간다. `#제목` 이 붙은 링크는 **그 제목까지** 간다 —
 * linkNav.followHref 는 다른 문서를 열 때 `#제목` 을 버린다(`openFile(경로)`).
 * 웹 주소·PDF·저장 안 한 문서·없는 제목 안내는 linkNav 에 맡긴다.
 */
export function follow(href, ctx, editor) {
  const r = resolveHref(href, ctx?.path)
  if (r.kind === 'anchor' && revealIn(editor, { heading: r.anchor })) return
  if (r.kind === 'file' && OPENABLE.test(r.target) && ctx?.openFile) {
    ctx.openFile(r.target, r.anchor ? { heading: r.anchor } : undefined)
    return
  }
  followHref(href, ctx)
}

/*
 * 문서 안의 링크는 **Ctrl+누르기**(또는 가운데 단추)로 따라간다 (CLAUDE.md). 그냥 누르는 것은
 * 글자를 고치려는 것이다 — 그때는 링크 풍선이 뜬다 (LinkBubble.jsx).
 *
 * 브라우저 기본 동작을 **먼저** 막아야 한다. 막지 않으면 WebView2 가 Ctrl+누르기·가운데
 * 단추를 "새 창으로 열기" 로 받아 따로 팝업 창을 띄운다. 그래서 ProseMirror 의 handleClick
 * 이 아니라 DOM 의 click·auxclick 을 **캡처 단계**에서 받는다.
 *
 * Lexical 때는 화면의 href 에 `https://` 가 붙어서 노드에게 물어야 했다. Tiptap 은 링크
 * 표시(mark)가 마크다운에 적힌 주소를 그대로 들고 있으므로 그 값을 쓴다.
 */

function hrefAt(view, a) {
  try {
    const pos = view.posAtDOM(a, 0)
    const $pos = view.state.doc.resolve(pos)
    const marks = [...$pos.marks(), ...($pos.nodeAfter?.marks ?? [])]
    const m = marks.find((x) => x.type.name === 'link')
    if (m) return m.attrs.href
  } catch { /* 화면과 문서가 잠깐 어긋난 때 — 아래로 */ }
  return a.getAttribute('href')
}

/** 편집기 DOM 에 링크 누르기 처리를 건다. 돌려주는 함수로 뗀다 */
export function attachLinkClicks(view, getCtx, getEditor) {
  const onClick = (e) => {
    // Obsidian 식 [[내부 링크]] — 글자 그대로인 것을 꾸밈으로 칠해 둔 것이다 (wikilinks.js)
    const w = e.target?.closest?.('.md-wikilink')
    if (w && view.dom.contains(w) && (e.ctrlKey || e.metaKey || e.button === 1)) {
      e.preventDefault()
      e.stopPropagation()
      followWiki(w.dataset.wiki, getCtx(), getEditor())
      return
    }
    const a = e.target?.closest?.('a[href]')
    if (!a || !view.dom.contains(a)) return
    const go = e.ctrlKey || e.metaKey || e.button === 1
    // 그냥 누르기는 편집이다 — 브라우저가 링크로 다루지 못하게만 막고 ProseMirror 에 맡긴다
    e.preventDefault()
    if (!go) return
    e.stopPropagation()
    follow(hrefAt(view, a), getCtx(), getEditor())
  }
  const onAux = (e) => { if (e.button === 1) onClick(e) }
  // 마우스를 올리면 어디로 가는지와 어떻게 가는지를 알려 준다
  const onOver = (e) => {
    const a = e.target?.closest?.('a[href]')
    if (a && view.dom.contains(a) && !a.title) a.title = `${hrefAt(view, a)} — Ctrl+클릭으로 열기`
  }
  // 가운데 단추를 누르는 순간 생기는 자동 스크롤 표시도 막는다
  const onDown = (e) => { if (e.button === 1 && e.target?.closest?.('a[href]')) e.preventDefault() }
  view.dom.addEventListener('click', onClick, true)
  view.dom.addEventListener('auxclick', onAux, true)
  view.dom.addEventListener('mousedown', onDown, true)
  view.dom.addEventListener('mouseover', onOver)
  return () => {
    view.dom.removeEventListener('mouseover', onOver)
    view.dom.removeEventListener('click', onClick, true)
    view.dom.removeEventListener('auxclick', onAux, true)
    view.dom.removeEventListener('mousedown', onDown, true)
  }
}

/** Ctrl 을 누르고 있는 동안만 링크에 손가락 커서 (`body.md-ctrl`, editor.css) */
export function watchCtrl() {
  const set = (e) => document.body.classList.toggle('md-ctrl', e.ctrlKey || e.metaKey)
  const off = () => document.body.classList.remove('md-ctrl')
  window.addEventListener('keydown', set)
  window.addEventListener('keyup', set)
  window.addEventListener('blur', off)
  return () => {
    window.removeEventListener('keydown', set)
    window.removeEventListener('keyup', set)
    window.removeEventListener('blur', off)
  }
}
