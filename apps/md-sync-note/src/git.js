import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@md/editor-core'
import { baseName } from './repos.js'

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
