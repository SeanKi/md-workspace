/**
 * 문서를 연 뒤 찾은 자리로 스크롤하고 그 글자를 선택해 준다.
 *
 * 에디터가 마운트되는 데 시간이 걸리므로 잠깐씩 다시 시도한다.
 * 본문은 위지윅이라 화면 글자에는 마크다운 기호가 없다 — `# 제목` 은 "제목" 으로
 * 그려진다. 그래서 기호를 걷어낸 줄로 먼저 찾아보고, 안 되면 찾던 낱말로 찾는다.
 */

const strip = (s) => (s ?? '')
  .replace(/^[#>\s|-]*/, '')
  .replace(/[*_`~|]/g, '')
  .replace(/…/g, '')
  .trim()

function findIn(root, needle) {
  const want = needle.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const at = node.nodeValue.toLowerCase().indexOf(want)
    if (at >= 0) return { node, at, len: needle.length }
  }
  return null
}

function select({ node, at, len }) {
  const range = document.createRange()
  range.setStart(node, at)
  range.setEnd(node, Math.min(at + len, node.nodeValue.length))
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  const el = node.parentElement
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/**
 * @param {string[]} candidates 찾아볼 글자들. 앞쪽이 더 정확한 것
 */
export async function revealText(candidates, { tries = 25, wait = 120 } = {}) {
  const wanted = candidates.map(strip).filter((s) => s.length >= 2)
  if (wanted.length === 0) return false

  for (let t = 0; t < tries; t += 1) {
    const root = document.querySelector('.prose')
    if (root) {
      for (const c of wanted) {
        const hit = findIn(root, c)
        if (hit) { select(hit); return true }
      }
    }
    await new Promise((r) => setTimeout(r, wait))
  }
  return false
}
