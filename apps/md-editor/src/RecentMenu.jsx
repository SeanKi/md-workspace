import React, { useEffect } from 'react'
import { baseName } from './paths.js'

/**
 * 최근에 연 문서 목록.
 *
 * 이름만 보여주면 어느 것인지 모른다 — 폴더가 다를 뿐 이름이 같은 문서가 흔하다.
 * 그래서 이름 아래에 경로를 함께 둔다.
 */
export default function RecentMenu({ at, items, onPick, onClear, onClose }) {
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.recent-menu')) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    // 메뉴를 연 바로 그 누름으로 다시 닫히지 않게 다음 차례에 단다
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  return (
    <div className="recent-menu" style={{ right: at.right, top: at.top }}>
      {items.length === 0 ? (
        <div className="recent-empty">최근에 연 문서가 없습니다</div>
      ) : (
        items.map((p) => (
          <button key={p} className="recent-item" onClick={() => onPick(p)} title={p}>
            <span className="recent-name">{baseName(p)}</span>
            <span className="recent-path">{p}</span>
          </button>
        ))
      )}
      {items.length > 0 && (
        <button className="recent-clear" onClick={onClear}>목록 비우기</button>
      )}
    </div>
  )
}
