/** 열 수 있는 파일 판정과 이름 뽑기. 여러 곳에서 쓰므로 여기 모아둔다. */

export const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }]
export const OPENABLE = /\.(md|markdown|mdx|txt)$/i

export const baseName = (p) => (p ? p.replace(/\\/g, '/').split('/').pop() : '제목 없음')

/** 확장자를 뗀 파일 이름 */
const stem = (p) => baseName(p).replace(/\.[^.]+$/, '')

// 제목은 문서 맨 앞에 있다. 타이핑할 때마다 300KB 를 훑을 이유가 없다
const HEAD = 8000

/** `# 제목` 안의 강조·링크·코드 표기를 걷어낸다. 제목줄에 기호가 보이면 안 된다 */
function plain(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // [글자](주소) → 글자
    .replace(/[*_~`]/g, '')
    .replace(/\\(.)/g, '$1')
    .trim()
}

/**
 * 문서 제목 — 웹 페이지의 `<title>` 에 해당하는 것.
 *
 * 문서의 첫 제목줄(`# 제목`, 또는 밑줄식 `제목` + `===`)을 쓰고,
 * 없으면 확장자를 뗀 파일 이름으로 떨어진다.
 * 코드블록 안의 `#` 은 주석이지 제목이 아니므로 건너뛴다.
 */
export function docTitle(markdown, path) {
  const lines = (markdown ?? '').slice(0, HEAD).split('\n')
  let fence = null
  let i = 0

  // 프론트매터는 제목이 아니다
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---')
    if (end > 0) i = end + 1
  }

  for (; i < lines.length; i += 1) {
    const line = lines[i]
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) { const m = f[1][0]; fence = fence === null ? m : (fence === m ? null : fence); continue }
    if (fence !== null) continue

    const atx = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line)
    if (atx) return plain(atx[1]) || stem(path)

    // 밑줄식 제목 — 글자 있는 줄 바로 아래가 `===` 이면 그 줄이 제목이다
    if (line.trim() && /^\s{0,3}=+\s*$/.test(lines[i + 1] ?? '')) return plain(line) || stem(path)
  }
  return stem(path)
}
