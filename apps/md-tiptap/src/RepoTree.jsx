import React, { useCallback, useEffect, useRef, useState } from 'react'
import { listDir } from './repos.js'
import useTreeOps from './useTreeOps.js'
import useTreeDrag from './useTreeDrag.js'
import TreeNode from './TreeNode.jsx'
import GitLine from './GitLine.jsx'
import TreeMenu from './TreeMenu.jsx'
import NameDialog from './NameDialog.jsx'
import RemoteLine from './sync/RemoteLine.jsx'

export default function RepoTree({ repo, activePath, onOpen, onRemove, onMove, onView, first, last, gitTick, onPathChanged, sync, onSync, onRemote }) {
  // 원격이 붙은 저장소는 로컬이 캐시다 — 받지 않은 문서는 원격 목록(catalog)으로 ☁ 를 그린다
  const catalog = repo.remote ? (sync?.catalog ?? null) : null
  // 펼침 상태는 환경 파일에 남는다 (repo.open · repo.expanded) — 다음에 열 때 그대로
  const [open, setOpenState] = useState(repo.open !== false)
  const setOpen = (fn) => {
    const n = typeof fn === 'function' ? fn(open) : fn
    setOpenState(n)
    onView?.({ open: n })
  }
  // 폴더 펼침 — 저장소 기준 상대 경로(`/`)로 적는다. 저장소 폴더를 옮겨도 그대로 맞는다
  const rel = (abs) => abs.replace(/\\/g, '/').slice(repo.path.replace(/\\/g, '/').replace(/\/+$/, '').length + 1)
  const expanded = new Set(repo.expanded ?? [])
  const exp = {
    has: (abs) => expanded.has(rel(abs)),
    set: (abs, on) => {
      const r = rel(abs)
      if (expanded.has(r) === on) return
      const next = new Set(expanded)
      if (on) next.add(r); else next.delete(r)
      onView?.({ expanded: [...next] })
    },
  }
  const [roots, setRoots] = useState(null)
  const [error, setError] = useState(null)
  const ops = useTreeOps({ onOpen, onPathChanged, remote: !!repo.remote })
  const drag = useTreeDrag({ onDrop: ops.move })
  const rootVer = ops.versions[repo.path] ?? 0

  // 펼침을 적을 때마다 repo 객체가 새로 온다 — 그때마다 뿌리를 다시 읽지 않게 경로·종류로만 묶는다
  const repoRef = useRef(repo)
  repoRef.current = repo
  const loadRoots = useCallback(() => {
    listDir(repoRef.current, repoRef.current.path, catalog)
      .then((r) => { setRoots(r); setError(null) })
      .catch((e) => { setError(String(e)); setRoots([]) })
  }, [repo.path, repo.kind, catalog])

  useEffect(() => { if (open) loadRoots() }, [open, rootVer, loadRoots])

  // 저장소 뿌리에서는 만들기만 할 수 있다 — 저장소 자체를 지우는 건 "제거(×)" 다
  const rootTarget = { path: repo.path, name: repo.name, is_dir: true, isRoot: true }

  return (
    <div className="repo">
      <div className={'repo-head' + (drag.over === repo.path ? ' drop-over' : '')}
           data-drop={repo.path}
           onClick={() => { if (!drag.consumeClick()) setOpen((v) => !v) }}
           onContextMenu={(e) => ops.openMenu(e, rootTarget)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="repo-name">{repo.name}</span>
        <span className="spacer" />
        {/* 순서 바꾸기 — 끌기는 이미 "파일을 이 저장소로 옮기기" 라서 단추로 */}
        <span className="repo-move">
          <button type="button" disabled={first} title="위로"
                  onClick={(e) => { e.stopPropagation(); onMove?.(-1) }}>▲</button>
          <button type="button" disabled={last} title="아래로"
                  onClick={(e) => { e.stopPropagation(); onMove?.(1) }}>▼</button>
        </span>
        <span className="repo-x" title="저장소 제거"
              onClick={(e) => { e.stopPropagation(); onRemove(repo.id) }}>×</span>
      </div>
      <div className="repo-path" title={repo.path}>{repo.path}</div>
      <GitLine repo={repo} tick={gitTick} />
      <RemoteLine repo={repo} st={sync} onSync={onSync} onSetup={onRemote} />
      {ops.notice && <div className={'node ' + (ops.notice.ok ? 'ok' : 'err')}>{ops.notice.text}</div>}
      {open && (
        error ? <div className="node err">{error}</div>
        : roots === null ? <div className="node muted">읽는 중…</div>
        : roots.length === 0 ? <div className="node muted">(비어 있음) — 오른쪽 버튼으로 새 노트</div>
        : roots.map((e) => (
            <TreeNode key={e.path} repo={repo} entry={e} depth={0} exp={exp}
                      activePath={activePath} onOpen={onOpen} ops={ops} drag={drag} catalog={catalog} />
          ))
      )}

      {/* 끌고 있는 동안 손끝을 따라다니는 이름표. 어디에 놓이는지도 함께 말해 준다 */}
      {drag.drag && (
        <div className="tree-ghost" style={{ left: drag.drag.x + 14, top: drag.drag.y + 10 }}>
          {drag.drag.entry.name}
          <span>{drag.over ? '여기로 옮기기' : '폴더 위에 놓으세요'}</span>
        </div>
      )}

      {ops.menu && (
        <TreeMenu x={ops.menu.x} y={ops.menu.y}
                  items={ops.menuItems(ops.menu.target)} onClose={ops.closeMenu} />
      )}
      {ops.dialog && (
        <NameDialog
          title={ops.dialogTitle}
          value={ops.dialog.value}
          okLabel={ops.dialog.kind === 'rename' ? '이름 바꾸기' : '만들기'}
          check={ops.checkDialogName}
          onOk={ops.runDialog}
          onCancel={ops.cancelDialog}
        />
      )}
    </div>
  )
}
