import React, { useEffect, useRef } from 'react'

/**
 * 트리에서 오른쪽 버튼을 눌렀을 때 나오는 작은 메뉴.
 *
 * 화면 밖으로 나가지 않도록 위치를 접어 넣고, 바깥을 누르거나 Esc 를 누르면 닫힌다.
 */
export default function TreeMenu({ x, y, items, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    // 여는 클릭에 바로 닫히지 않도록 다음 차례에 등록한다
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, y - r.height)}px`
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, x - r.width)}px`
  }, [x, y])

  return (
    <div className="tree-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map((it, i) => (
        it.sep
          ? <div key={i} className="tree-menu-sep" />
          : (
            <button
              key={i}
              className={it.danger ? 'danger' : ''}
              onClick={() => { onClose(); it.run() }}
            >
              {it.label}
            </button>
          )
      ))}
    </div>
  )
}
