import React, { useCallback } from 'react'

export const SIDE_DEFAULT = 280
const MIN = 160
const MAX = 720

/**
 * 트리와 본문 사이의 세로 나누기 막대.
 *
 * 사이드바가 화면 왼쪽 끝에서 시작하므로 커서의 x 좌표가 곧 사이드바의 폭이다.
 * 마우스 이벤트만 받으면 안드로이드에서 손가락으로 끌 수 없다 — 포인터 이벤트로 받고,
 * 끄는 동안 막대가 포인터를 붙잡는다(setPointerCapture). 막대의 `touch-action: none` 은
 * 브라우저가 손가락 움직임을 스크롤로 가져가지 않게 한다 (app.css)
 */
export default function SideSplit({ onChange }) {
  const start = useCallback((e) => {
    if (e.button > 0) return
    e.preventDefault()
    const bar = e.currentTarget
    bar.setPointerCapture?.(e.pointerId)
    document.body.classList.add('col-resizing')
    const move = (ev) => onChange(Math.min(MAX, Math.max(MIN, ev.clientX)))
    const up = () => {
      document.body.classList.remove('col-resizing')
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      bar.removeEventListener('pointercancel', up)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
  }, [onChange])

  return (
    <div className="side-split" onPointerDown={start}
         onDoubleClick={() => onChange(SIDE_DEFAULT)}
         title="끌어서 트리 폭 조정 · 두 번 누르면 기본값" />
  )
}
