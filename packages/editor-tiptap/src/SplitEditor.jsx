import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import TiptapEditor from './Editor.jsx'
import DiffView from './DiffView.jsx'
import FindBar from './FindBar.jsx'

/*
 * 앱이 쓰는 편집기. 세 모드(위지윅 · 원본 · 비교)와 창 나누기를 맡는다.
 * editor-core/SplitEditor.jsx 의 자리를 대신한다.
 *
 * 내용은 상태로 올리지 않는다 — 앱은 `apiRef.current.getMarkdown()` 으로 필요할 때 꺼내고,
 * 이 화면이 사라질 때(탭을 옮길 때) `onLeave(마크다운)` 으로 마지막 내용을 받는다.
 *
 * 창 나누기는 MDXEditor 때처럼 내용을 통째로 옮겨 담지 않는다. 한쪽의 편집 단계를
 * 다른 쪽에 그대로 적용하므로 두 화면이 늘 같고, 커서·되돌리기도 화면마다 살아 있다.
 */

const MODES = [['rich-text', '위지윅'], ['source', '원본'], ['diff', '비교']]
const keep = (e) => e.preventDefault()

function ModeSwitch({ mode, onMode, split, onSplit, onFind }) {
  return (
    <span className="tt-modes">
      {/* 찾기 — 폰·태블릿은 Ctrl+F 를 누를 수 없다 */}
      {mode !== 'diff' && (
        <button type="button" className="find-btn" title="본문에서 찾기 (Ctrl+F)" onMouseDown={keep} onClick={onFind}>🔍</button>
      )}
      {MODES.map(([m, label]) => (
        <button key={m} type="button" className={mode === m ? 'on' : ''} onMouseDown={keep} onClick={() => onMode(m)}>{label}</button>
      ))}
      {mode === 'rich-text' && (
        <button type="button" className={`split-btn${split ? ' on' : ''}`} title="창 나누기" onMouseDown={keep} onClick={onSplit}>⬒</button>
      )}
    </span>
  )
}

export default function SplitEditor({ markdown, ctxRef, wide, viewMode = 'rich-text', apiRef, onDirty, onLeave, onError, reveal }) {
  const [mode, setMode] = useState(viewMode)
  const [base, setBase] = useState(markdown)       // 위지윅 화면이 읽어 들인 글
  const [gen, setGen] = useState(0)                // 위지윅 화면을 다시 만들 때 올린다
  const [text, setText] = useState(viewMode === 'rich-text' ? '' : markdown)
  const [ratio, setRatio] = useState(0)            // 0 이면 나누지 않음
  const [find, setFind] = useState(null)           // 찾기 줄. 열려 있으면 { initial }
  const textarea = useRef(null)
  const top = useRef(null)
  const bottom = useRef(null)
  const shell = useRef(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const textRef = useRef(text)
  textRef.current = text

  const current = useCallback(() => (
    modeRef.current === 'rich-text' ? (top.current?.getMarkdown() ?? base) : textRef.current
  ), [base])

  useImperativeHandle(apiRef, () => ({
    getMarkdown: current,
    getTitle: () => top.current?.getTitle?.() ?? '',
    getStats: () => top.current?.getStats?.() ?? null,
    mode: () => modeRef.current,
  }), [current])

  // 탭을 옮기면 이 화면이 사라진다. 그 직전의 내용을 앱에 넘긴다.
  // useLayoutEffect 의 정리는 자식 편집기가 치워지기 **전에** 돈다
  const leave = useRef(onLeave)
  leave.current = onLeave
  useLayoutEffect(() => () => leave.current?.(current()), [current])

  // 찾기 줄을 연다. 고른 글자가 있으면 그것으로 찾는다
  const openFind = useCallback(() => {
    let initial = ''
    const ed = top.current?.editor
    if (modeRef.current === 'rich-text' && ed) {
      const { from, to } = ed.state.selection
      initial = ed.state.doc.textBetween(from, to, ' ')
    } else if (textarea.current) {
      const t = textarea.current
      initial = t.value.slice(t.selectionStart, t.selectionEnd)
    }
    // 여러 줄이나 긴 선택은 찾을 말이 아니라 그냥 고른 것이다
    if (initial.includes('\n') || initial.length > 80) initial = ''
    setFind((f) => ({ initial: initial || f?.initial || '', n: (f?.n ?? 0) + 1 }))
  }, [])

  // Ctrl+F — 브라우저(WebView) 의 찾기 대신 본문 찾기 줄
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.shiftKey || e.altKey) return
      e.preventDefault()
      openFind()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFind])

  const findBar = find && mode !== 'diff' && (
    <FindBar key={`${mode}-${gen}-${find.n}`} initial={find.initial} onClose={() => setFind(null)}
      getEditor={() => (modeRef.current === 'rich-text' ? top.current?.editor ?? null : null)}
      getTextarea={() => textarea.current} />
  )

  // 링크·검색 결과로 왔으면 그 자리로 (reveal.js). 편집기가 막 만들어진 참일 수 있어
  // 못 찾으면 몇 번 더 본다 — 큰 문서는 그리는 데 시간이 든다
  useEffect(() => {
    if (!reveal || modeRef.current !== 'rich-text') return
    let tries = 0
    let timer = 0
    const go = () => {
      if (top.current?.reveal(reveal.target)) return
      if (++tries < 8) timer = setTimeout(go, 80)
    }
    const raf = requestAnimationFrame(go)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [reveal])

  const switchMode = (m) => {
    if (m === mode) return
    if (mode === 'rich-text') setText(top.current?.getMarkdown() ?? base)
    if (m === 'rich-text') {
      // 원본에서 고친 글로 위지윅을 다시 만든다. 이때부터 그 글이 "원문" 이다
      setBase(textRef.current)
      setGen((g) => g + 1)
      setRatio(0)
    }
    setMode(m)
  }

  // 아래 화면이 시작할 문서. 위 화면의 원문 묶음(저장 기준)은 위 화면만 들고 있으면 된다
  const splitDoc = useRef(null)
  const onSplit = () => {
    if (!ratio) splitDoc.current = top.current?.editor.getJSON() ?? null
    setRatio((r) => (r ? 0 : 0.5))
  }

  // 두 화면 사이 막대 끌기 — 포인터 캡처로 창 밖까지 따라간다
  const dragBar = (e) => {
    e.preventDefault()
    const box = shell.current.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev) => {
      const r = (ev.clientY - box.top) / box.height
      setRatio(Math.min(0.85, Math.max(0.15, r)))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const switcher = <ModeSwitch mode={mode} onMode={switchMode} split={ratio > 0} onSplit={onSplit}
    onFind={() => (find ? setFind(null) : openFind())} />
  const wrap = 'editor-wrap' + (wide ? ' wide' : '')

  if (mode !== 'rich-text') {
    return (
      <div className="tt-shell">
        <div className="tt-toolbar"><span className="grow" />{switcher}</div>
        {findBar}
        {mode === 'source'
          ? (
            <div className={wrap + ' source'}>
              <textarea ref={textarea} className="source-view" value={text} spellCheck={false}
                onChange={(e) => { setText(e.target.value); onDirty?.() }} />
            </div>
          )
          : (
            <div className={wrap + ' source'}>
              <DiffView mine={text} theirs={markdown} leftLabel="지금 편집" rightLabel="열었을 때" maxRows={0} tall />
            </div>
          )}
      </div>
    )
  }

  const pane = (ref, other, extra, docJSON) => (
    <TiptapEditor key={`${gen}`} ref={ref} markdown={base} ctxRef={ctxRef} docJSON={docJSON}
      onDirty={onDirty} onError={onError} toolbarExtra={extra}
      onSteps={(steps) => other.current?.applySteps(steps)} />
  )

  if (!ratio) {
    return <div className="tt-shell">{findBar}<div className={wrap}>{pane(top, bottom, switcher)}</div></div>
  }
  return (
    <div className="tt-shell split" ref={shell}>
      {findBar}
      <div className={wrap} style={{ flex: `${ratio} 1 0` }}>{pane(top, bottom, switcher)}</div>
      <div className="tt-split-bar" onPointerDown={dragBar}><span /></div>
      <div className={wrap} style={{ flex: `${1 - ratio} 1 0` }}>{pane(bottom, top, null, splitDoc.current)}</div>
    </div>
  )
}
