import { followHref } from '@md/editor-core/src/linkNav.js'

/*
 * 문서 안의 링크는 **Ctrl+누르기**로 따라간다 (CLAUDE.md). 그냥 누르는 것은 글자를
 * 고치려는 것이다.
 *
 * Lexical 때는 화면의 href 에 `https://` 가 붙어서 노드에게 물어야 했다. Tiptap 은
 * 링크 표시(mark)의 href 를 그대로 들고 있으므로 그 값을 쓴다.
 */

function linkAt(view, pos) {
  const $pos = view.state.doc.resolve(pos)
  const marks = [...$pos.marks(), ...($pos.nodeAfter?.marks ?? [])]
  return marks.find((m) => m.type.name === 'link')?.attrs.href ?? null
}

export function handleLinkClick(view, pos, event, ctx) {
  if (!(event.ctrlKey || event.metaKey)) return false
  const href = linkAt(view, pos)
  if (!href) return false
  event.preventDefault()
  followHref(href, ctx)
  return true
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
