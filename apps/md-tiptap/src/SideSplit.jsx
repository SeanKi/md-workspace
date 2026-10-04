import React, { useCallback } from 'react'

export const SIDE_DEFAULT = 280
const MIN = 160
const MAX = 720

/**
 * 트리와 본문 사이의 세로 나누기 막대.
 *
 * 사이드바가 화면 왼쪽 끝에서 시작하므로 커서의 x 좌표가 곧 사이드바의 폭이다.
 */
export default function SideSplit({ onChange }) {
  const start = useCallback((e) => {
    e.preventDefault()
    document.body.classList.add('col-resizing')
    const move = (ev) => onChange(Math.min(MAX, Math.max(MIN, ev.clientX)))
    const up = () => {
      document.body.classList.remove('col-resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [onChange])

  return (
    <div className="side-split" onMouseDown={start}
         onDoubleClick={() => onChange(SIDE_DEFAULT)}
         title="끌어서 트리 폭 조정 · 두 번 누르면 기본값" />
  )
}
