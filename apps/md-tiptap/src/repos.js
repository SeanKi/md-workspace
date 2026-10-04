import { invoke, isTauri } from './core.js'

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
 * 폴더 한 단계를 읽는다.
 *
 * 원격이 붙은 저장소는 로컬 폴더가 **캐시**다 — 받지 않은 문서는 로컬에 없다. 그래서 원격의
 * 문서 목록(catalog, 동기화가 준다)에서 이 폴더 아래의 것을 찾아 ☁ 로 섞는다 (`remote: true`).
 * 누르면 그때 받는다 (App 의 openDoc).
 */
export async function listDir(repo, path, catalog = null) {
  if (repo.kind !== 'local') throw new Error(`아직 지원하지 않는 저장소 종류: ${repo.kind}`)
  // 원격에만 있는 폴더(☁)는 로컬에 아직 없다 — 그때는 원격 목록만으로 그린다
  const local = isTauri
    ? await invoke('read_dir', { path }).catch((e) => { if (catalog?.length) return []; throw e })
    : (DEMO[path] ?? [])
  if (!catalog?.length) return local

  const root = repo.path.replace(/\\/g, '/').replace(/\/+$/, '')
  const here = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const prefix = here.length > root.length ? here.slice(root.length + 1) + '/' : ''
  const have = new Set(local.map((e) => e.name.toLowerCase()))
  const extra = new Map()
  for (const c of catalog) {
    if (c.cached || !c.path.startsWith(prefix)) continue
    const rest = c.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    const name = slash < 0 ? rest : rest.slice(0, slash)
    if (!name || have.has(name.toLowerCase()) || extra.has(name.toLowerCase())) continue
    extra.set(name.toLowerCase(), { name, path: `${here}/${name}`, is_dir: slash >= 0, remote: true })
  }
  return [...local, ...extra.values()].sort((a, b) =>
    (b.is_dir - a.is_dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
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
