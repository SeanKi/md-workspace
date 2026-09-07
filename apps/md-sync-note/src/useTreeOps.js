import { useCallback, useEffect, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@md/editor-core'
import {
  checkName, createDir, createNote, deletePath, dirOf, isInside, join, renamePath, samePath,
} from './fileOps.js'
import { copyText, hasMdEditor, openInMdEditor } from './shell.js'

/**
 * 트리에서 만들고 · 이름 바꾸고 · 옮기고 · 지우는 동작.
 *
 * 바뀐 자리의 상위 폴더만 다시 읽는다(`versions`). 트리 전체를 다시 그리면
 * 펼쳐 둔 것이 모두 접혀 어디를 보고 있었는지 잃어버린다.
 *
 * @param onPathChanged (옛경로, 새경로|null, 종류) — 열려 있는 문서가 영향을 받을 때와
 *        저장소에 커밋으로 남길 일이 생겼을 때 알린다. 종류는 rename · move · delete.
 */
export default function useTreeOps({ onOpen, onPathChanged }) {
  const [versions, setVersions] = useState({})
  const [menu, setMenu] = useState(null)      // { x, y, target }
  const [dialog, setDialog] = useState(null)  // { kind, parent|target, value }
  const [notice, setNotice] = useState(null)   // { text, ok }
  const [editorHere, setEditorHere] = useState(false)

  // MD Notepad 가 옆에 없으면 메뉴에 항목을 내지 않는다 (눌러도 실패할 뿐이다)
  useEffect(() => { hasMdEditor().then(setEditorHere).catch(() => setEditorHere(false)) }, [])

  const refresh = useCallback((path) => {
    setVersions((v) => ({ ...v, [path]: (v[path] ?? 0) + 1 }))
  }, [])

  const say = useCallback((text, ok) => {
    setNotice({ text, ok })
    setTimeout(() => setNotice(null), ok ? 2500 : 5000)
  }, [])

  const fail = useCallback((e) => say(String(e).replace(/^Error:\s*/, ''), false), [say])

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
      onPathChanged?.(t.path, null, 'delete')
    } catch (e) { fail(e) }
  }, [refresh, onPathChanged, fail])

  const startRename = useCallback((t) => {
    if (!t || t.isRoot) return
    setDialog({ kind: 'rename', target: t, value: t.name })
  }, [])

  /**
   * 끌어다 놓아 다른 폴더로 옮긴다.
   *
   * 파일 시스템에는 "순서" 라는 것이 없으므로 같은 폴더 안에서 자리를 바꾸는 일은
   * 없다. 폴더를 자기 자신(또는 자기 아래)으로 넣는 것도 막아야 한다 —
   * 그렇게 하면 옮긴 것이 통째로 사라진 것처럼 보인다.
   */
  const move = useCallback(async (entry, toDir) => {
    const from = entry.path
    const parent = dirOf(from)
    if (samePath(parent, toDir)) {
      fail('이미 그 폴더에 있습니다. 같은 폴더 안에서는 순서를 바꿀 수 없습니다.')
      return
    }
    if (entry.is_dir && (samePath(from, toDir) || isInside(toDir, from))) {
      fail('폴더를 자기 자신 안으로 옮길 수 없습니다.')
      return
    }
    const to = join(toDir, entry.name)
    try {
      await renamePath(from, to)
      refresh(parent)
      refresh(toDir)
      onPathChanged?.(from, to, 'move')
    } catch (e) { fail(e) }
  }, [refresh, onPathChanged, fail])

  const openElsewhere = useCallback(async (t) => {
    try {
      await openInMdEditor(t.path)
      say(`MD Notepad 로 열었습니다 — ${t.name}`, true)
    } catch (e) { fail(e) }
  }, [say, fail])

  const copyPath = useCallback(async (t) => {
    try {
      await copyText(t.path)
      say('경로를 복사했습니다', true)
    } catch (e) { fail(e) }
  }, [say, fail])

  /** 지금 누른 자리에서 할 수 있는 것들 */
  const menuItems = useCallback((t) => {
    const items = []
    if (t.is_dir) {
      items.push({ label: '새 노트', run: () => setDialog({ kind: 'note', parent: t.path, value: '' }) })
      items.push({ label: '새 폴더', run: () => setDialog({ kind: 'dir', parent: t.path, value: '' }) })
    }

    if (items.length) items.push({ sep: true })
    if (!t.is_dir && editorHere) items.push({ label: 'MD Notepad 로 열기', run: () => openElsewhere(t) })
    items.push({ label: '경로 복사', run: () => copyPath(t) })

    if (!t.isRoot) {
      items.push({ sep: true })
      items.push({ label: '이름 바꾸기 (F2)', run: () => startRename(t) })
      items.push({ label: '삭제 (휴지통으로)', danger: true, run: () => remove(t) })
    }
    return items
  }, [remove, startRename, editorHere, openElsewhere, copyPath])

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
        onPathChanged?.(d.target.path, to, 'rename')
      }
    } catch (e) { fail(e) }
  }, [dialog, refresh, onOpen, onPathChanged, fail])

  return {
    versions, menu, dialog, dialogTitle, notice,
    openMenu, closeMenu, menuItems, startRename, move,
    runDialog, cancelDialog: () => setDialog(null), checkDialogName,
  }
}
