import { invoke, isTauri } from '@md/editor-core'

/* 저장소 = { id, name, kind, path }. 지금은 로컬 폴더만 지원한다.
   목록을 어디에 담는지는 `config.js` (실행 파일 옆 MDSyncNote.ini). */

export const baseName = (p) => (p ? p.replace(/[\\/]+$/, '').replace(/\\/g, '/').split('/').pop() : '')

/** 문서 경로가 어느 저장소에 속하는지. 겹치면 더 깊은(긴) 쪽이 이긴다. */
export function repoOf(repos, filePath) {
  if (!filePath) return null
  const norm = (p) => p.replace(/\\/g, '/').replace(/[/]+$/, '').toLowerCase()
  const f = norm(filePath)
  return repos
    .filter((r) => r.kind === 'local' && f.startsWith(norm(r.path) + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null
}

/**
 * 폴더 한 단계를 읽는다. 저장소 종류가 늘어나면 여기서 갈라진다.
 * (kind: 'local' | 'webdav' | 'ftp' | ...)
 */
export async function listDir(repo, path) {
  if (repo.kind !== 'local') throw new Error(`아직 지원하지 않는 저장소 종류: ${repo.kind}`)
  if (!isTauri) return DEMO[path] ?? []
  return invoke('read_dir', { path })
}

// 브라우저에서 UI 를 확인하기 위한 더미 트리
const DEMO = {
  '/demo': [
    { name: 'IT', path: '/demo/IT', is_dir: true },
    { name: 'English', path: '/demo/English', is_dir: true },
    { name: 'diary.md', path: '/demo/diary.md', is_dir: false },
  ],
  '/demo/IT': [
    { name: 'programming', path: '/demo/IT/programming', is_dir: true },
    { name: 'network.md', path: '/demo/IT/network.md', is_dir: false },
  ],
  '/demo/IT/programming': [
    { name: 'cpp.md', path: '/demo/IT/programming/cpp.md', is_dir: false },
    { name: 'tauri.md', path: '/demo/IT/programming/tauri.md', is_dir: false },
  ],
  '/demo/English': [
    { name: 'vocabulary.md', path: '/demo/English/vocabulary.md', is_dir: false },
  ],
}
