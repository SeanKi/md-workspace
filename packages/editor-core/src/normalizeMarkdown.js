// 닫는 슬래시가 없는 void 태그를 자가닫힘으로 고친다.
//
// MDXEditor 는 마크다운을 MDX 로 읽는다. MDX 에서 `<br>` 은 JSX 여는 태그라
// 닫는 태그를 기다리다 파싱이 통째로 실패한다.
//
//   Error parsing markdown: Expected a closing tag for `<br>` ...
//
// 반면 GitHub·VS Code·Obsidian 은 `<br>` 을 그냥 줄바꿈으로 읽는다. 즉 파일이
// 잘못된 게 아니라 이 에디터만 못 읽는 것이다. 그래서 파일을 열 때 `<br />` 로
// 바꿔 준다. 두 표기는 어느 도구에서나 결과가 같다.
//
// 건드리지 않는 것:
// - 코드블록(``` ~~~)과 인라인 코드 안 — 예제 코드를 고쳐 버리면 안 된다
// - 이미 자가닫힘인 `<br />`, `<br/>` — MDX 가 알아보므로 그대로 둔다
// - 속성이 붙은 `<br class="x">` — 속성을 지우거나 옮기는 판단은 하지 않는다

const VOID_TAGS = ['br', 'hr']
const VOID_RE = new RegExp(`<(${VOID_TAGS.join('|')})\\s*>`, 'gi')
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const INLINE_CODE_RE = /(`+[^`]*`+)/

/**
 * @param {string} markdown
 * @returns {{ text: string, count: number }} count 는 바꾼 개수 (0 이면 원본 그대로)
 */
export function normalizeVoidTags(markdown) {
  if (!markdown || !VOID_RE.test(markdown)) return { text: markdown, count: 0 }
  VOID_RE.lastIndex = 0

  let count = 0
  let fence = null   // 열려 있는 코드펜스의 문자 (` 또는 ~)

  const text = markdown.split('\n').map((line) => {
    const f = FENCE_RE.exec(line)
    if (f) {
      const marker = f[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      return line
    }
    if (fence !== null) return line

    // 홀수 칸이 인라인 코드다 (split 의 캡처 그룹)
    return line.split(INLINE_CODE_RE).map((part, i) => (
      i % 2 === 1 ? part : part.replace(VOID_RE, (_, tag) => {
        count += 1
        return `<${tag.toLowerCase()} />`
      })
    )).join('')
  }).join('\n')

  return { text, count }
}
