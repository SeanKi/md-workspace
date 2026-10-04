import React, { useCallback, useEffect, useRef, useState } from 'react'
import { samePath } from './core.js'
import { listDir } from './repos.js'

const under = (path, dir) =>
  path.replace(/\\/g, '/').toLowerCase().startsWith(dir.replace(/\\/g, '/').toLowerCase() + '/')

/**
 * 트리의 한 줄. 폴더면 펼침/접힘과 지연 로딩까지 맡는다.
 *
 * 줄마다 포커스를 받을 수 있어야 F2 로 이름을 바꿀 수 있고,
 * 폴더 줄에는 `data-drop` 을 달아 놓아야 끌어다 놓을 자리로 찾힌다.
 */
export default function TreeNode({ repo, entry, depth, activePath, onOpen, ops, drag, catalog }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState(null)
  const [error, setError] = useState(null)
  const ver = ops.versions[entry.path] ?? 0

  const load = useCallback(async () => {
    try { setKids(await listDir(repo, entry.path, catalog)); setError(null) }
    catch (e) { setError(String(e)); setKids([]) }
  }, [repo, entry.path, catalog])

  // 원격 목록이 바뀌면(맞추고 나면) 펼쳐 둔 폴더는 다시 그린다 — ☁ 가 받은 것으로 바뀐다
  useEffect(() => { if (open && kids !== null) load() }, [catalog])   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (next && kids === null) await load()
  }, [open, kids, load])

  // 이 폴더 안에서 뭔가 만들거나 지웠으면 다시 읽는다. 만든 것이 보이도록 펼친다
  useEffect(() => {
    if (ver === 0) return
    setOpen(true)
    load()
  }, [ver])   // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * 탭을 고르면 그 문서가 트리에서도 켜져야 한다. 접힌 폴더 안에 있으면 켜 봐야
   * 보이지 않으므로 **가는 길의 폴더를 펼친다.**
   *
   * 활성 문서가 **바뀐 순간에만** 펼친다. 매번 보면 사용자가 접은 폴더를 그 자리에서
   * 다시 펼쳐 버려 접을 수가 없다.
   */
  const seen = useRef(activePath)
  useEffect(() => {
    const changed = seen.current !== activePath
    seen.current = activePath
    if (!changed || !entry.is_dir || !activePath || !under(activePath, entry.path)) return
    setOpen(true)
    if (kids === null) load()
  }, [activePath])   // eslint-disable-line react-hooks/exhaustive-deps

  // 들여쓰기 — 폴더는 화살표를 달고 파일은 안 단다. 그대로 두면 같은 층의
  // 파일이 폴더보다 **왼쪽**으로 나와 층이 어긋나 보인다.
  // 파일에 화살표 자리(CARET)만큼을 주면 아이콘이 형제 폴더와 **정확히 같은 자리**에 선다.
  const STEP = 16      // 한 층
  const CARET = 19     // 화살표 칸(15) + 사이 여백(4). app.css 의 .caret 과 짝이다
  const NUDGE = 0      // 형제 폴더와 아이콘을 맞춘다 (더 밀면 층이 어긋나 보인다)
  const indent = (d, isDir) => ({ paddingLeft: 8 + d * STEP + (isDir ? 0 : CARET + NUDGE) })

  const pad = indent(depth, entry.is_dir)
  const sub = indent(depth + 1, false)

  // 누르고 있는 중 · 끌고 있는 중 · 놓을 자리 — 셋 다 눈에 보여야 한다
  const mark =
    (drag.holding === entry.path ? ' holding' : '') +
    (drag.dragging === entry.path ? ' dragging' : '') +
    (entry.is_dir && drag.over === entry.path ? ' drop-over' : '')

  const common = {
    style: pad,
    tabIndex: 0,
    title: entry.path,
    onContextMenu: (e) => ops.openMenu(e, entry),
    // 받지 않은 ☁ 것은 옮기거나 이름을 바꿀 수 없다 — 먼저 열어서 받는다
    onPointerDown: (e) => { if (!entry.remote) drag.press(e, entry) },
    onKeyDown: (e) => {
      if (e.key === 'F2' && !entry.remote) { e.preventDefault(); ops.startRename(entry) }
    },
  }

  // 켜진 문서인가 — 글자 비교로는 못 맞춘다. 링크로 연 문서는 `C:/a/b.md` 로 온다
  const on = samePath(activePath, entry.path) ? ' on' : ''

  if (!entry.is_dir) {
    return (
      <div
        {...common}
        className={'node file' + on + mark + (entry.remote ? ' remote' : '')}
        onClick={() => { if (!drag.consumeClick()) onOpen(entry.path) }}
      >
        <span className="ico">{entry.remote ? '☁' : '📄'}</span>{entry.name}
      </div>
    )
  }

  return (
    <>
      <div
        {...common}
        className={'node dir' + mark + (entry.remote ? ' remote' : '')}
        data-drop={entry.path}
        onClick={() => { if (!drag.consumeClick()) toggle() }}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="ico">{entry.remote ? '☁' : open ? '📂' : '📁'}</span>{entry.name}
      </div>
      {open && (
        kids === null
          ? <div className="node muted" style={sub}>읽는 중…</div>
          : error
            ? <div className="node err" style={sub}>{error}</div>
            : kids.length === 0
              ? <div className="node muted" style={sub}>(비어 있음)</div>
              : kids.map((k) => (
                  <TreeNode key={k.path} repo={repo} entry={k} depth={depth + 1}
                            activePath={activePath} onOpen={onOpen} ops={ops} drag={drag} catalog={catalog} />
                ))
      )}
    </>
  )
}
