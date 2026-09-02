import { useCallback, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@md/editor-core'
import { checkName, createDir, createNote, deletePath, dirOf, join, renamePath } from './fileOps.js'

/**
 * 트리에서 만들고 · 이름 바꾸고 · 지우는 동작.
 *
 * 바뀐 자리의 상위 폴더만 다시 읽는다(`versions`). 트리 전체를 다시 그리면
 * 펼쳐 둔 것이 모두 접혀 어디를 보고 있었는지 잃어버린다.
 *
 * @param onPathChanged (옛경로, 새경로|null) — 열려 있는 문서가 영향을 받을 때 알린다
 */
export default function useTreeOps({ onOpen, onPathChanged }) {
  const [versions, setVersions] = useState({})
  const [menu, setMenu] = useState(null)      // { x, y, target }
  const [dialog, setDialog] = useState(null)  // { kind, parent|target, value }
  const [notice, setNotice] = useState('')

  const refresh = useCallback((path) => {
    setVersions((v) => ({ ...v, [path]: (v[path] ?? 0) + 1 }))
  }, [])

  const fail = useCallback((e) => {
    setNotice(String(e).replace(/^Error:\s*/, ''))
    setTimeout(() => setNotice(''), 5000)
  }, [])

  const openMenu = useCallback((e, target) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  const remove = useCallback(async (t) => {
    const q = `"${t.name}" 을(를) 휴지통으로 보낼까요?`
    const ok = isTauri
      ? await confirm(q, { title: '삭제', kind: 'warning' })
      : window.confirm(q)
    if (!ok) return
    try {
      await deletePath(t.path)
      refresh(dirOf(t.path))
      onPathChanged?.(t.path, null)
    } catch (e) { fail(e) }
  }, [refresh, onPathChanged, fail])

  /** 지금 누른 자리에서 할 수 있는 것들 */
  const menuItems = useCallback((t) => {
    const items = []
    if (t.is_dir) {
      items.push({ label: '새 노트', run: () => setDialog({ kind: 'note', parent: t.path, value: '' }) })
      items.push({ label: '새 폴더', run: () => setDialog({ kind: 'dir', parent: t.path, value: '' }) })
    }
    if (!t.isRoot) {
      if (items.length) items.push({ sep: true })
      items.push({ label: '이름 바꾸기', run: () => setDialog({ kind: 'rename', target: t, value: t.name }) })
      items.push({ label: '삭제 (휴지통으로)', danger: true, run: () => remove(t) })
    }
    return items
  }, [remove])

  const dialogTitle = dialog && (
    dialog.kind === 'note' ? '새 노트'
      : dialog.kind === 'dir' ? '새 폴더'
        : '이름 바꾸기'
  )

  const checkDialogName = useCallback((raw) => (
    checkName(raw, { asNote: dialog?.kind === 'note' || (dialog?.kind === 'rename' && !dialog.target.is_dir) })
  ), [dialog])

  const runDialog = useCallback(async (name) => {
    const d = dialog
    setDialog(null)
    if (!d) return
    try {
      if (d.kind === 'note') {
        const path = join(d.parent, name)
        await createNote(path)
        refresh(d.parent)
        onOpen?.(path)          // 만들었으면 바로 열어 준다
      } else if (d.kind === 'dir') {
        await createDir(join(d.parent, name))
        refresh(d.parent)
      } else {
        const to = join(dirOf(d.target.path), name)
        if (to === d.target.path) return
        await renamePath(d.target.path, to)
        refresh(dirOf(d.target.path))
        onPathChanged?.(d.target.path, to)
      }
    } catch (e) { fail(e) }
  }, [dialog, refresh, onOpen, onPathChanged, fail])

  return {
    versions, menu, dialog, dialogTitle, notice,
    openMenu, closeMenu, menuItems,
    runDialog, cancelDialog: () => setDialog(null), checkDialogName,
  }
}
