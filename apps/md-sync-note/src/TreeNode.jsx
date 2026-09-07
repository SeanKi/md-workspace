import React, { useCallback, useEffect, useState } from 'react'
import { listDir } from './repos.js'

/**
 * 트리의 한 줄. 폴더면 펼침/접힘과 지연 로딩까지 맡는다.
 *
 * 줄마다 포커스를 받을 수 있어야 F2 로 이름을 바꿀 수 있고,
 * 폴더 줄에는 `data-drop` 을 달아 놓아야 끌어다 놓을 자리로 찾힌다.
 */
export default function TreeNode({ repo, entry, depth, activePath, onOpen, ops, drag }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState(null)
  const [error, setError] = useState(null)
  const ver = ops.versions[entry.path] ?? 0

  const load = useCallback(async () => {
    try { setKids(await listDir(repo, entry.path)); setError(null) }
    catch (e) { setError(String(e)); setKids([]) }
  }, [repo, entry.path])

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

  // 들여쓰기 — 폴더는 화살표를 달고 파일은 안 단다. 그대로 두면 같은 층의
  // 파일이 폴더보다 **왼쪽**으로 나와 층이 어긋나 보인다.
  // 파일에 화살표 자리(CARET)를 그대로 주고 조금(NUDGE) 더 밀어 파일이 오른쪽에 오게 한다.
  const STEP = 16      // 한 층
  const CARET = 14     // 화살표 칸 + 사이 여백
  const NUDGE = 6      // 파일이 폴더보다 이만큼 오른쪽
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
    onPointerDown: (e) => drag.press(e, entry),
    onKeyDown: (e) => {
      if (e.key === 'F2') { e.preventDefault(); ops.startRename(entry) }
    },
  }

  if (!entry.is_dir) {
    return (
      <div
        {...common}
        className={'node file' + (activePath === entry.path ? ' on' : '') + mark}
        onClick={() => { if (!drag.consumeClick()) onOpen(entry.path) }}
      >
        <span className="ico">📄</span>{entry.name}
      </div>
    )
  }

  return (
    <>
      <div
        {...common}
        className={'node dir' + mark}
        data-drop={entry.path}
        onClick={() => { if (!drag.consumeClick()) toggle() }}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="ico">{open ? '📂' : '📁'}</span>{entry.name}
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
                            activePath={activePath} onOpen={onOpen} ops={ops} drag={drag} />
                ))
      )}
    </>
  )
}
