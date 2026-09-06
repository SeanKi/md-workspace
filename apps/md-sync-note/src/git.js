import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@md/editor-core'
import { baseName } from './repos.js'
import { dirOf } from './fileOps.js'

const NONE = { has_git: false, is_repo: false, branch: '', changes: 0 }

/** 저장소의 git 상태. 실패해도 UI 가 죽지 않도록 기본값을 돌려준다. */
export async function gitStatus(repo) {
  if (!isTauri || repo.kind !== 'local') return NONE
  try {
    return await invoke('git_status', { path: repo.path })
  } catch {
    return NONE
  }
}

export function gitInit(repo) {
  return invoke('git_init', { path: repo.path })
}

/** 저장 직후 호출. 변경이 없으면 커밋하지 않는다(committed: false). */
export function gitCommit(repoPath, message) {
  return invoke('git_commit', { path: repoPath, message })
}

/** 커밋 메시지. 무엇을 언제 저장했는지가 이력에서 바로 보이도록. */
export function commitMessage(filePath) {
  const t = new Date()
  const z = (n) => String(n).padStart(2, '0')
  const when = `${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())} ${z(t.getHours())}:${z(t.getMinutes())}`
  return `${baseName(filePath)} 저장 (${when})`
}

/**
 * 트리에서 한 파일 조작의 커밋 메시지.
 *
 * git 은 이름 바꾸기·옮기기를 따로 기록하지 않고 "지우고 새로 만들었다" 로 본다.
 * 나중에 이력을 읽는 사람이 그게 무슨 일이었는지 알 수 있도록 말로 남긴다.
 */
export function opMessage(kind, from, to) {
  const name = baseName(from)
  if (kind === 'rename') return `이름 바꾸기: ${name} → ${baseName(to)}`
  if (kind === 'move') return `옮기기: ${name} (${baseName(dirOf(from))} → ${baseName(dirOf(to))})`
  if (kind === 'delete') return `삭제: ${name}`
  return `변경: ${name}`
}

/** 여러 건이면 첫 줄에 요약하고 본문에 모두 적는다 */
export function joinMessages(texts) {
  if (texts.length === 1) return texts[0]
  return `${texts[0]} 외 ${texts.length - 1}건\n\n${texts.map((t) => `- ${t}`).join('\n')}`
}
