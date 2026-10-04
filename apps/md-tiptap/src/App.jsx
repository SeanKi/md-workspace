import React, { useCallback, useEffect, useRef, useState } from 'react'
import { TiptapEditor, IMAGE_DIR } from '@md/editor-tiptap'
import { startDiag, note } from '@md/editor-core/src/diag.js'
import { isTauri } from '@md/editor-core/src/tauriBridge.js'
import useDocFile from './useDocFile.js'
import { SAMPLE } from './sample.js'

/*
 * Tiptap 시험판 — 한 번에 문서 하나. 목적은 "MDXEditor 로 되던 것이 Tiptap 으로 얼마나
 * 되는가" 를 확인하는 것이라 탭·최근 목록 같은 껍데기는 일부러 뺐다.
 *
 * [검사] 단추가 왕복 상태를 알려 준다 — 몇 블록이 원문 그대로 나가고 몇 블록을 새로 쓰는지.
 */

const baseName = (p) => (p ? p.split(/[\\/]/).pop() : '')
const confirmDiscard = (dirty) => !dirty || window.confirm('저장하지 않은 내용이 있습니다. 버리고 계속할까요?')

export default function App() {
  const [doc, setDoc] = useState({ key: 1, path: null, name: '견본.md', text: SAMPLE })
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState('rich')   // 'rich' | 'source'
  const [source, setSource] = useState('')
  const [msg, setMsg] = useState('')
  const [title, setTitle] = useState('')
  const editorRef = useRef(null)
  const say = useCallback((m) => setMsg(m), [])
  const files = useDocFile({ say })

  const state = useRef({})
  state.current = { doc, dirty, mode, source }

  const load = useCallback((d) => {
    if (!d) return
    setDoc((old) => ({ key: old.key + 1, path: d.path, name: d.name, text: d.text }))
    setDirty(false)
    setMode('rich')
    say(`열었습니다 — ${d.name}`)
  }, [say])

  const currentText = () => (state.current.mode === 'source' ? state.current.source : editorRef.current?.getMarkdown() ?? '')

  const saveDoc = useCallback(async (asNew = false) => {
    const { doc: d } = state.current
    const p = await files.save(d, currentText(), asNew)
    if (!p) return null
    // 편집기는 다시 만들지 않는다 (커서·되돌리기가 날아간다). 경로만 바꾼다
    setDoc((old) => ({ ...old, path: isTauri ? p : old.path, name: baseName(p) }))
    setDirty(false)
    say(`저장했습니다 — ${baseName(p)}`)
    return isTauri ? p : null
  }, [files, say])

  const openPath = useCallback(async (p) => {
    if (!confirmDiscard(state.current.dirty)) return
    load(await files.readPath(p))
  }, [files, load])

  const ctxRef = useRef({})
  ctxRef.current = {
    path: doc.path,
    imageDir: IMAGE_DIR,
    openFile: openPath,
    // 이미지는 문서 폴더 기준이라 저장하지 않은 문서는 저장부터 받는다
    ensureSaved: () => saveDoc(false),
  }

  const actions = {
    newDoc: () => { if (confirmDiscard(state.current.dirty)) load({ path: null, name: 'untitled.md', text: '' }) },
    open: async () => { if (confirmDiscard(state.current.dirty)) load(await files.openDialog()) },
    save: () => saveDoc(false),
    saveAs: () => saveDoc(true),
    toggleSource: () => {
      const s = state.current
      if (s.mode === 'rich') {
        setSource(editorRef.current?.getMarkdown() ?? '')
        setMode('source')
        return
      }
      // 원본에서 고쳤으면 그 글로 편집기를 다시 만든다. 이때부터는 그 글이 "원문" 이다
      setDoc((old) => ({ ...old, key: old.key + 1, text: s.source }))
      setMode('rich')
    },
    check: () => {
      if (state.current.mode !== 'rich') { say('위지윅 화면에서 검사합니다'); return }
      const r = editorRef.current?.getStats()
      if (!r) return
      say(`블록 ${r.total}개 — 원문 그대로 ${r.total - r.rewritten} · 새로 씀 ${r.rewritten} · 원문 조각 ${r.raw}` +
        ` · 열 때와 바이트 동일: ${r.same ? '예' : '아니오'} · 직렬화 ${r.ms.toFixed(1)}ms`)
    },
  }
  const act = useRef(actions)
  act.current = actions

  useEffect(() => startDiag('md-tiptap'), [])
  // 개발 중에는 브라우저 콘솔·자동 시험에서 편집기를 만질 수 있게 내놓는다
  if (import.meta.env.DEV) window.__tt = editorRef

  // 단축키
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const run = { o: 'open', n: 'newDoc', '/': 'toggleSource' }[k] ?? (k === 's' ? (e.shiftKey ? 'saveAs' : 'save') : null)
      if (!run) return
      e.preventDefault()
      act.current[run]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 창에 파일을 끌어다 놓으면 연다 (Tauri 는 OS 레벨에서 드롭을 가로챈다 — CLAUDE.md)
  useEffect(() => {
    if (!isTauri) return
    let off = null
    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type !== 'drop') return
        const p = e.payload.paths?.find((x) => /\.(md|markdown|txt)$/i.test(x))
        if (p) openPath(p)
      }).then((u) => { off = u }))
    return () => off?.()
  }, [openPath])

  // 문서 제목은 타이핑이 멎고 0.5초 뒤에 센다
  useEffect(() => {
    const t = setTimeout(() => setTitle(editorRef.current?.getTitle?.() ?? ''), 500)
    return () => clearTimeout(t)
  }, [dirty, doc.key])

  const shown = title || doc.name
  useEffect(() => {
    const text = `${dirty ? '● ' : ''}${shown} — MD Tiptap 시험판 ${__APP_VERSION__}`
    document.title = text
    if (!isTauri) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(text))
      .catch((e) => note(`창 제목 실패: ${e}`))
  }, [shown, dirty])

  return (
    <>
      <div className="titlebar">
        <span className="name">{dirty && <span className="dot">● </span>}{shown}</span>
        <span className="path">{doc.path ?? (isTauri ? '저장 안 됨' : '브라우저 — 저장하면 내려받기')}</span>
        <span className="spacer" />
        <button type="button" onClick={actions.newDoc} title="새 문서 (Ctrl+N)">새로</button>
        <button type="button" onClick={actions.open} title="열기 (Ctrl+O)">열기</button>
        <button type="button" onClick={actions.save} title="저장 (Ctrl+S)">저장</button>
        <button type="button" onClick={actions.saveAs} title="다른 이름으로 (Ctrl+Shift+S)">다른 이름</button>
        <button type="button" className={mode === 'source' ? 'on' : ''} onClick={actions.toggleSource} title="원본 보기 (Ctrl+/)">원본</button>
        <button type="button" onClick={actions.check} title="왕복 검사">검사</button>
      </div>
      <div className={`editor-wrap ${mode === 'source' ? 'source' : ''}`}>
        {mode === 'rich' ? (
          <TiptapEditor key={doc.key} ref={editorRef} markdown={doc.text} ctxRef={ctxRef}
            onDirty={() => { if (!state.current.dirty) setDirty(true) }} />
        ) : (
          <textarea className="source-view" value={source} spellCheck={false}
            onChange={(e) => { setSource(e.target.value); if (!dirty) setDirty(true) }} />
        )}
      </div>
      {msg && <div className="statusbar" onClick={() => setMsg('')}>{msg}</div>}
    </>
  )
}
