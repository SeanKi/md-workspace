import React, { useCallback, useEffect, useRef, useState } from 'react'
import Editor from './Editor.jsx'

/** 이보다 얕게 끌면 나누지 않는다 (실수로 살짝 내린 것) */
const MIN = 0.12
/** 편집이 멎고 이만큼 지나면 반대쪽 화면에 옮겨 담는다 */
const SYNC_MS = 350

/**
 * 한 문서를 위·아래 두 화면으로 나눠 보는 편집기 (Word · Visual Studio 의 창 나누기).
 *
 * 본문 맨 위의 손잡이를 끌어내리면 **내린 자리**에서 나뉜다. 두 화면 모두 진짜
 * 편집기라 각각 다른 곳을 보며 고칠 수 있다.
 *
 * 핵심 규칙 — **편집 중인 화면에는 절대 setMarkdown 을 하지 않는다.**
 * 그렇게 하면 커서와 되돌리기 이력이 통째로 날아간다. 그래서 내용은 언제나
 * "방금 고친 쪽 → 놀고 있는 쪽" 한 방향으로만 옮겨 담는다.
 */
export default function SplitEditor({ markdown, onChange, ctxRef, wide }) {
  const [ratio, setRatio] = useState(0)        // 0 이면 나누지 않은 상태
  const [dragging, setDragging] = useState(false)

  const shellRef = useRef(null)
  const boxTop = useRef(null)                  // 스크롤 상자 (위치를 되돌리려고 본다)
  const boxBottom = useRef(null)
  const apiTop = useRef(null)                  // MDXEditorMethods
  const apiBottom = useRef(null)

  const content = useRef(markdown)             // 두 화면이 공유하는 진짜 내용
  const applying = useRef(false)               // setMarkdown 이 되부른 onChange 인가
  const timer = useRef(0)

  const split = ratio > 0

  /* ---------- 두 화면의 내용 맞추기 ---------- */

  const pushToOther = useCallback((from) => {
    const api = from === 'top' ? apiBottom.current : apiTop.current
    const box = from === 'top' ? boxBottom.current : boxTop.current
    if (!api || api.getMarkdown() === content.current) return
    // setMarkdown 은 본문을 통째로 다시 만든다. 보고 있던 자리는 되돌려 준다
    const keep = box?.scrollTop ?? 0
    applying.current = true
    api.setMarkdown(content.current)
    setTimeout(() => { applying.current = false }, 0)
    if (box) requestAnimationFrame(() => { box.scrollTop = keep })
  }, [])

  const handle = useCallback((from, md, initialNormalize) => {
    if (applying.current || md === content.current) return
    content.current = md
    onChange?.(md, initialNormalize)
    if (!split) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => pushToOther(from), SYNC_MS)
  }, [onChange, pushToOther, split])

  const onTop = useCallback((md, n) => handle('top', md, n), [handle])
  const onBottom = useCallback((md, n) => handle('bottom', md, n), [handle])

  // 나눔을 걷을 때, 아래 화면의 마지막 편집이 아직 옮겨지지 않았을 수 있다
  const wasSplit = useRef(split)
  useEffect(() => {
    if (wasSplit.current && !split) {
      clearTimeout(timer.current)
      pushToOther('bottom')
    }
    wasSplit.current = split
  }, [split, pushToOther])

  useEffect(() => () => clearTimeout(timer.current), [])

  /* ---------- 손잡이 끌기 ---------- */

  const startDrag = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const move = (ev) => {
      const r = shellRef.current?.getBoundingClientRect()
      if (!r || r.height === 0) return
      const v = (ev.clientY - r.top) / r.height
      setRatio(v < MIN || v > 1 - MIN ? 0 : v)
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])

  /* ---------- 렌더 ---------- */

  const paneClass = 'editor-wrap' + (wide ? ' wide' : '')

  return (
    <div className={'split-shell' + (dragging ? ' dragging' : '')} ref={shellRef}>
      {!split && (
        <div className="split-grab" onMouseDown={startDrag}
             onDoubleClick={() => setRatio(0.5)}
             title="끌어내리면 화면이 위아래로 나뉩니다 (두 번 누르면 절반)">
          <span />
        </div>
      )}

      <div className={paneClass + ' pane-top'} ref={boxTop}
           style={split ? { flexGrow: ratio } : undefined}>
        <Editor markdown={markdown} onChange={onTop} ctxRef={ctxRef} editorRef={apiTop} />
      </div>

      {split && (
        <>
          <div className="split-bar" onMouseDown={startDrag}
               onDoubleClick={() => setRatio(0)}
               title="끌어서 크기 조정 · 두 번 누르면 다시 합칩니다">
            <span />
          </div>
          {/* 아래 화면은 나눌 때 만들어진다. markdown 은 처음 한 번만 쓰인다
              (MDXEditor 는 prop 이 바뀌어도 다시 읽지 않는다) */}
          <div className={paneClass + ' pane-bottom'} ref={boxBottom}
               style={{ flexGrow: 1 - ratio }}>
            <Editor markdown={content.current} onChange={onBottom}
                    ctxRef={ctxRef} editorRef={apiBottom} />
          </div>
        </>
      )}
    </div>
  )
}
