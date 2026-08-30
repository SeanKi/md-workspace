/** 열 수 있는 파일 판정과 이름 뽑기. 여러 곳에서 쓰므로 여기 모아둔다. */

export const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }]
export const OPENABLE = /\.(md|markdown|mdx|txt)$/i

export const baseName = (p) => (p ? p.replace(/\\/g, '/').split('/').pop() : '제목 없음')
