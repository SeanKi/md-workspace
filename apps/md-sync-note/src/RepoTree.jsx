import React, { useCallback, useEffect, useState } from 'react'
import { listDir } from './repos.js'
import useTreeOps from './useTreeOps.js'
import useTreeDrag from './useTreeDrag.js'
import TreeNode from './TreeNode.jsx'
import GitLine from './GitLine.jsx'
import TreeMenu from './TreeMenu.jsx'
import NameDialog from './NameDialog.jsx'

export default function RepoTree({ repo, activePath, onOpen, onRemove, gitTick, onPathChanged }) {
  const [open, setOpen] = useState(true)
  const [roots, setRoots] = useState(null)
  const [error, setError] = useState(null)
  const ops = useTreeOps({ onOpen, onPathChanged })
  const drag = useTreeDrag({ onDrop: ops.move })
  const rootVer = ops.versions[repo.path] ?? 0

  const loadRoots = useCallback(() => {
    listDir(repo, repo.path)
      .then((r) => { setRoots(r); setError(null) })
      .catch((e) => { setError(String(e)); setRoots([]) })
  }, [repo])

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
        <span className="repo-x" title="저장소 제거"
              onClick={(e) => { e.stopPropagation(); onRemove(repo.id) }}>×</span>
      </div>
      <div className="repo-path" title={repo.path}>{repo.path}</div>
      <GitLine repo={repo} tick={gitTick} />
      {ops.notice && <div className={'node ' + (ops.notice.ok ? 'ok' : 'err')}>{ops.notice.text}</div>}
      {open && (
        error ? <div className="node err">{error}</div>
        : roots === null ? <div className="node muted">읽는 중…</div>
        : roots.length === 0 ? <div className="node muted">(비어 있음) — 오른쪽 버튼으로 새 노트</div>
        : roots.map((e) => (
            <TreeNode key={e.path} repo={repo} entry={e} depth={0}
                      activePath={activePath} onOpen={onOpen} ops={ops} drag={drag} />
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
