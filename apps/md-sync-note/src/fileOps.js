import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@md/editor-core'

/** Windows 파일 이름에 못 쓰는 글자. 미리 걸러야 Rust 까지 갔다가 실패하지 않는다. */
const BAD_NAME = /[\\/:*?"<>|]/

export const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '')
export const join = (dir, name) => `${dir.replace(/[\\/]+$/, '')}/${name}`

/**
 * 이름을 다듬고 문제가 있으면 이유를 돌려준다.
 * @returns {{ name?: string, error?: string }}
 */
export function checkName(raw, { asNote }) {
  const name = (raw ?? '').trim()
  if (!name) return { error: '이름을 입력하세요.' }
  if (BAD_NAME.test(name)) return { error: '\\ / : * ? " < > | 는 쓸 수 없습니다.' }
  if (name === '.' || name === '..') return { error: '쓸 수 없는 이름입니다.' }
  if (name.endsWith('.') || name.endsWith(' ')) return { error: '점이나 공백으로 끝날 수 없습니다.' }
  // 노트는 확장자를 붙여 준다. 사용자가 매번 .md 를 치게 할 이유가 없다
  if (asNote && !/\.(md|markdown|mdx)$/i.test(name)) return { name: `${name}.md` }
  return { name }
}

const demo = () => { throw new Error('브라우저 데모 모드에서는 파일을 바꿀 수 없습니다.') }

export const createDir = (path) => (isTauri ? invoke('create_dir', { path }) : demo())
export const createNote = (path) => (isTauri ? invoke('create_file', { path, contents: '' }) : demo())
export const renamePath = (from, to) => (isTauri ? invoke('rename_path', { from, to }) : demo())
/** 영영 지우지 않고 휴지통으로 보낸다. */
export const deletePath = (path) => (isTauri ? invoke('delete_path', { path }) : demo())
