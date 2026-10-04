import { useCallback, useRef } from 'react'
import { repoOf } from './repos.js'
import { gitCommit, opMessage, joinMessages } from './git.js'

/**
 * 트리에서 한 이름 바꾸기 · 옮기기 · 삭제를 모아 뒀다가 한 커밋으로 남긴다.
 *
 * 바로 커밋하지 않는 이유 — 이름을 고치다 보면 연달아 몇 번 손대게 되는데,
 * 그때마다 커밋하면 이력이 잔가지로 뒤덮인다. 그래서 자동 저장과 같은 박자로 묶는다.
 *
 * git 은 이름 바꾸기를 따로 기록하지 않는다("지우고 새로 만들었다" 로 본다).
 * 나중에 이력을 읽는 사람이 알아볼 수 있도록 무엇을 어떻게 했는지 메시지에 적는다.
 */
export default function usePendingCommits({ cfgRef, setStatus, setGitTick }) {
  const pending = useRef([])   // [{ repoPath, text }]

  const note = useCallback((kind, from, to) => {
    const repo = repoOf(cfgRef.current.repos, from)
    if (!repo || !kind) return
    pending.current.push({ repoPath: repo.path, text: opMessage(kind, from, to) })
  }, [cfgRef])

  const flush = useCallback(async () => {
    const { settings: cfg, repos: rs } = cfgRef.current
    if (!cfg.autoCommit || pending.current.length === 0) return
    const list = pending.current
    pending.current = []

    const byRepo = new Map()
    for (const it of list) byRepo.set(it.repoPath, [...(byRepo.get(it.repoPath) ?? []), it.text])

    for (const [repoPath, texts] of byRepo) {
      if (!rs.some((r) => r.path === repoPath)) continue    // 그 사이에 저장소를 뺐다
      try {
        const r = await gitCommit(repoPath, joinMessages(texts))
        if (r.committed) {
          const more = texts.length > 1 ? ` 외 ${texts.length - 1}건` : ''
          setStatus(`${texts[0]}${more} · ${r.detail}`)
          setGitTick((n) => n + 1)
        }
      } catch (e) {
        setStatus(`커밋 실패: ${e}`)
      }
    }
  }, [cfgRef, setStatus, setGitTick])

  return { note, flush }
}
