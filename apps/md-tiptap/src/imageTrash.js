import { invoke, note } from './core.js'

/*
 * 문서에서 지운 그림을 치운다 — 저장할 때 디스크의 이전 글과 새 글을 견주어서.
 *
 * - 대상은 **이 문서의 그림 폴더(`.image/`) 안의 것만**이다. `../공용/로고.png` 같은 남의 그림은 건드리지 않는다
 * - 저장소의 다른 문서가 같은 그림을 쓰고 있으면 남긴다
 * - 지우지 않고 그림 옆 `.mdtrash/` 로 옮긴다. 되돌리기(Ctrl+Z)로 그림이 다시 나타나면 다음 저장 때
 *   제자리로 꺼낸다. OS 휴지통은 프로그램이 꺼낼 수 없어서 쓰지 않는다
 * - 원격(WebDAV)의 그림은 그대로 둔다 — 다른 기기가 아직 그 그림이 있는 판을 보고 있을 수 있다
 */

const MD_IMG = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\s*\)/g
const HTML_IMG = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi

function decode(s) {
  try { return decodeURI(s) } catch { return s }
}

/** 글 속 그림 중 그림 폴더 안의 것 — 문서 기준 상대 경로 (`.image/x.png`) */
export function localImages(md, imageDir) {
  const sub = String(imageDir ?? '.image').trim().replace(/^\.[\\/]+/, '').replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const out = new Set()
  if (!md || !sub) return out
  for (const re of [MD_IMG, HTML_IMG]) {
    for (const m of md.matchAll(re)) {
      const rel = decode(m[1] ?? m[2]).replace(/\\/g, '/').replace(/^\.\//, '')
      if (rel.startsWith(sub + '/') && !rel.includes('..') && !/^[a-z]+:/i.test(rel)) out.add(rel)
    }
  }
  return out
}

const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '')
const nameOf = (p) => p.split('/').pop()

/**
 * 저장 직후 부른다. `before` 는 쓰기 전 디스크의 글, `after` 는 방금 쓴 글.
 * `root` 는 다른 문서를 찾아볼 범위 (저장소, 없으면 문서 폴더). 치운 그림 수를 돌려준다
 */
export async function tidyImages({ docPath, before, after, imageDir, root }) {
  const old = localImages(before, imageDir)
  const now = localImages(after, imageDir)
  const abs = (rel) => `${dirOf(docPath)}/${rel}`

  // 되돌리기로 돌아온 그림 — 휴지통에 있으면 꺼낸다
  for (const rel of now) {
    if (!old.has(rel) && (await invoke('asset_restore', { path: abs(rel) }))) note(`그림 되살림: ${rel}`)
  }

  let moved = 0
  for (const rel of [...old].filter((r) => !now.has(r))) {
    const name = nameOf(rel)
    const users = await invoke('asset_users', { root, names: [name, encodeURI(name)], except: docPath })
    if (users.length) continue
    await invoke('asset_to_trash', { path: abs(rel) })
    note(`안 쓰는 그림을 휴지통으로: ${rel}`)
    moved++
  }
  return moved
}
