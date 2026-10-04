import { TextSelection } from '@tiptap/pm/state'
import { searchDoc } from './find.js'

/*
 * 문서 안의 한 자리로 데려간다 — 링크의 `#제목`, `[[노트#제목]]`, 저장소 검색 결과.
 *
 * MDXEditor 때(revealText.js)는 화면의 DOM 글자를 찾아 브라우저 선택을 걸었다. Tiptap 에서는
 * 그게 세 군데서 어긋난다 (그래서 "열리기는 하는데 그 자리로 안 간다"):
 *   1. 탭을 바꾼 직후에는 **이전 문서**의 화면이 아직 남아 있어 그쪽을 뒤진다
 *   2. DOM 선택을 걸어도 ProseMirror 가 다음 그리기에서 자기 선택으로 덮는다
 *   3. 숨은 화면(원본 모드)에는 찾을 글자가 없다
 * 그래서 **문서 모델**에서 찾고, 편집기 선택으로 옮기고, 그 노드의 DOM 만 굴린다.
 */

/** GitHub 식 앵커 — 소문자, 기호 빼고, 공백은 `-`. 한글은 글자로 남는다 (linkNav.js 와 같다) */
export const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .replace(/\s+/g, '-')

const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/** 검색 결과 줄에서 마크다운 기호를 걷어 화면 글자에 맞춘다 */
const strip = (s) => String(s ?? '')
  .replace(/^[#>\s|-]*/, '')
  .replace(/[*_`~|]/g, '')
  .replace(/…/g, '')
  .trim()

function findHeading(doc, anchor) {
  const want = slug(decode(anchor))
  if (!want) return null
  let at = null
  doc.descendants((n, pos) => {
    if (at !== null) return false
    if (n.type.name === 'heading') {
      if (slug(n.textContent) === want) at = pos
      return false
    }
    return true
  })
  return at
}

function flash(view, pos) {
  const dom = view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement)) return
  dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
  // 데려다 놓기만 하면 어디로 왔는지 모른다. 잠깐 칠해 준다 (editor.css .md-jump)
  dom.classList.add('md-jump')
  setTimeout(() => dom.classList.remove('md-jump'), 1600)
}

/**
 * @param editor Tiptap 편집기
 * @param target { heading?: string, texts?: string[] }
 * @returns 찾았는가
 */
export function revealIn(editor, target) {
  if (!editor || editor.isDestroyed || !target) return false
  const { state, view } = editor

  if (target.heading) {
    const pos = findHeading(state.doc, target.heading)
    if (pos !== null) {
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos + 1)))
      view.focus()
      flash(view, pos)
      return true
    }
  }

  for (const t of (target.texts ?? []).map(strip).filter((s) => s.length >= 2)) {
    const hit = searchDoc(state.doc, t)[0]
    if (!hit) continue
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, hit.from, hit.to)))
    view.focus()
    const { node } = view.domAtPos(hit.from)
    const el = node.nodeType === 1 ? node : node.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return true
  }
  return false
}
