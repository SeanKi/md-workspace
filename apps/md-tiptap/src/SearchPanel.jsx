import React, { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from './core.js'

/** 결과 칸 기본 높이 — 대략 열 줄 */
export const SEARCH_HEIGHT = 240
const MIN_H = 80

/** 결과 칸 아래의 가로 나누기 막대. 끌어서 높이, 두 번 누르면 기본값 */
function HSplit({ height, onHeight }) {
  const start = (e) => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = height
    document.body.classList.add('row-resizing')
    const max = window.innerHeight - 160
    const move = (ev) => onHeight?.(Math.round(Math.min(max, Math.max(MIN_H, h0 + ev.clientY - y0))))
    const up = () => {
      document.body.classList.remove('row-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className="search-split" onPointerDown={start} onDoubleClick={() => onHeight?.(SEARCH_HEIGHT)}
              title="끌어서 결과 칸 높이 조정 · 두 번 누르면 기본값"><span /></div>
}

const DEBOUNCE = 220   // 타이핑이 멎으면 찾는다

/**
 * 수정 시각을 짧게. 오늘 고친 것은 시각이, 올해 것은 월·일이 궁금하다.
 * 자리가 좁으므로 전체 시각은 title 로만 보여 준다.
 */
function whenShort(sec) {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${p2(d.getHours())}:${p2(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`
}

const whenFull = (sec) => (sec ? new Date(sec * 1000).toLocaleString() : '')

/** 여러 저장소를 훑고 결과를 파일별로 묶는다. */
async function run(repos, query) {
  const all = []
  let scanned = 0
  let truncated = false
  let ms = 0
  for (const repo of repos) {
    const r = await invoke('search_repo', { root: repo.path, query })
    all.push(...r.hits.map((h) => ({ ...h, repo: repo.name })))
    scanned += r.scanned
    truncated = truncated || r.truncated
    ms += r.ms
  }
  all.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line_no - b.line_no)

  // 파일별로 묶어야 눈으로 읽힌다
  const groups = []
  const byPath = new Map()
  for (const h of all) {
    let g = byPath.get(h.path)
    if (!g) {
      g = { path: h.path, name: h.name, repo: h.repo, modified: h.modified, hits: [] }
      byPath.set(h.path, g); groups.push(g)
    }
    g.hits.push(h)
  }
  return { groups, count: all.length, scanned, truncated, ms }
}

export default function SearchPanel({ repos, activePath, onOpen, height = SEARCH_HEIGHT, onHeight }) {
  const [query, setQuery] = useState('')
  const [scopeAll, setScopeAll] = useState(true)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const gen = useRef(0)   // 늦게 도착한 옛 검색 결과가 새 결과를 덮지 않게

  const targets = scopeAll ? repos : repos.filter((r) => activePath?.startsWith(r.path))

  useEffect(() => {
    const q = query.trim()
    if (!q || !isTauri) { setResult(null); setError(''); return }
    const mine = ++gen.current
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await run(targets, q)
        if (mine === gen.current) { setResult(r); setError('') }
      } catch (e) {
        if (mine === gen.current) { setError(String(e)); setResult(null) }
      }
      if (mine === gen.current) setBusy(false)
    }, DEBOUNCE)
    return () => clearTimeout(t)
  }, [query, scopeAll, repos.length, activePath])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="search">
      <div className="search-box">
        <input
          value={query}
          placeholder="저장소에서 찾기"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
        />
        {query && <span className="search-clear" onClick={() => setQuery('')}>×</span>}
      </div>

      {query.trim() && (
        <div className="search-meta">
          <label>
            <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
            모든 저장소
          </label>
          <span className="spacer" />
          {busy ? '찾는 중…'
            : error ? ''
              : result ? `${result.count}곳 · 파일 ${result.groups.length}개 · ${result.ms}ms` : ''}
        </div>
      )}

      {query.trim() && (
      <>
      {/* 결과는 정해진 높이 안에서 스크롤한다. 아래 막대로 높이를 바꾼다 — 안 그러면
          결과가 많을 때 트리가 화면 밖으로 밀려난다 */}
      <div className="search-results" style={{ height }}>
      {error && <div className="search-err">{error}</div>}

      {result && result.groups.length === 0 && !busy && (
        <div className="search-empty">찾은 것이 없습니다 ({result.scanned}개 문서를 봤습니다)</div>
      )}

      {result?.groups.map((g) => (
        <div key={g.path} className="search-group">
          <div className="search-file" title={g.path} onClick={() => onOpen(g.path)}>
            📄 {g.name}
            <span className="search-repo">{g.repo}</span>
            <span className="search-when" title={`수정 ${whenFull(g.modified)}`}>{whenShort(g.modified)}</span>
          </div>
          {g.hits.map((h, i) => (
            <div key={i} className="search-hit" onClick={() => onOpen(h.path, [h.line, [...h.line].slice(h.start, h.end).join('')])}>
              <span className="search-line-no">{h.line_no}</span>
              <span className="search-line">
                {h.end > h.start ? (
                  <>
                    {[...h.line].slice(0, h.start).join('')}
                    <mark>{[...h.line].slice(h.start, h.end).join('')}</mark>
                    {[...h.line].slice(h.end).join('')}
                  </>
                ) : h.line}
              </span>
            </div>
          ))}
        </div>
      ))}

      {result?.truncated && <div className="search-empty">결과가 많아 일부만 보여줍니다.</div>}
      </div>
      <HSplit height={height} onHeight={onHeight} />
      </>
      )}
    </div>
  )
}
