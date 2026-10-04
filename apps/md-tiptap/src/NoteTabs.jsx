import React, { useRef, useState } from 'react'
import { RecentMenu } from './core.js'
import { baseName } from './repos.js'

/**
 * 열어 둔 노트의 탭 줄.
 *
 * **같은 문서는 탭 하나뿐이다** — 트리에서 이미 열린 문서를 누르면 새로 열지 않고
 * 그 탭으로 간다(`App.jsx` 의 `openDoc`). 그래서 여기는 고르고 닫는 일만 한다.
 *
 * MD Notepad 의 탭과 달리 **창 밖으로 끌어내는 동작은 없다.** 이 앱은 창이 하나고,
 * 문서를 옮길 곳이 왼쪽 트리지 다른 창이 아니다.
 */
export default function NoteTabs({
  tabs, activeId, onSelect, onClose, recent, onPickRecent, onClearRecent,
}) {
  const recentBtn = useRef(null)
  const [recentAt, setRecentAt] = useState(null)
  const toggleRecent = () => setRecentAt((v) => {
    if (v) return null
    const r = recentBtn.current.getBoundingClientRect()
    return { right: window.innerWidth - r.right, top: r.bottom + 4 }
  })

  return (
    <div className="notetabs">
      <div className="notetab-strip">
        {tabs.length === 0 && <div className="notetab-empty">왼쪽 트리에서 문서를 고르세요 · Ctrl+O 로 아무 파일이나 · Ctrl+N 새 문서</div>}
        {tabs.map((t) => (
          <div
            key={t.id}
            className={'notetab' + (t.id === activeId ? ' on' : '')}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => { if (e.button === 1) onClose(t.id) }}
            title={t.path}
          >
            <span className="notetab-name">{baseName(t.path) || "새 문서"}</span>
            {t.dirty && <span className="notetab-dot">●</span>}
            <span className="notetab-x"
                  onClick={(e) => { e.stopPropagation(); onClose(t.id) }}>×</span>
          </div>
        ))}
      </div>

      <button ref={recentBtn} className={'notetab-recent' + (recentAt ? ' on' : '')}
              onClick={toggleRecent} title="최근 문서">🕘</button>

      {recentAt && (
        <RecentMenu at={recentAt} items={recent ?? []}
                    onPick={(p) => { setRecentAt(null); onPickRecent(p) }}
                    onClear={() => { setRecentAt(null); onClearRecent() }}
                    onClose={() => setRecentAt(null)} />
      )}
    </div>
  )
}
