import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@md/editor-core'

/**
 * 상단 영역에 놓았을 때만 파일을 여는 드롭 처리.
 *
 * Tauri 가 OS 레벨에서 드롭을 가로채므로 HTML5 dragover/drop 은 오지 않는다.
 * 대신 onDragDropEvent 가 주는 좌표를 드롭존 사각형과 직접 비교한다.
 * 좌표는 물리 픽셀이라 devicePixelRatio 로 나눠 CSS 픽셀로 맞춘다.
 *
 * @returns 'in' | 'out' | null  — 지금 커서가 드롭존 안인지 (표시용)
 */
export default function useFileDrop(zoneRef, onDrop) {
  const [where, setWhere] = useState(null)
  const cb = useRef(onDrop)
  cb.current = onDrop

  useEffect(() => {
    if (!isTauri) return
    let unlisten
    let cancelled = false

    const inZone = (pos) => {
      const el = zoneRef.current
      if (!el || !pos) return false
      const dpr = window.devicePixelRatio || 1
      const r = el.getBoundingClientRect()
      const x = pos.x / dpr
      const y = pos.y / dpr
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }

    import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((e) => {
          const { type, paths, position } = e.payload
          if (type === 'enter' || type === 'over') {
            setWhere(inZone(position) ? 'in' : 'out')
            return
          }
          setWhere(null)
          if (type !== 'drop') return
          cb.current(paths ?? [], inZone(position))
        }),
      )
      .then((un) => { if (cancelled) un(); else unlisten = un })

    return () => { cancelled = true; unlisten?.() }
  }, [zoneRef])

  return where
}
