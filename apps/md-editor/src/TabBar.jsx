import React, { useRef, useState } from 'react'
import { IconOpen, IconRecent, IconSave, IconSaveAs, IconGear } from './icons.jsx'
import useTabDrag from './useTabDrag.js'
import RecentMenu from './RecentMenu.jsx'

/**
 * 탭과 파일 단추가 한 줄에 있다. 제목줄은 없다 —
 * 문서 제목은 **창 제목(작업 표시줄)** 이 말한다 (`App.jsx`).
 *
 * 탭 쪽만 넘치면 옆으로 밀리고, 오른쪽 단추들은 늘 제자리에 있다.
 *
 * 탭은 끌 수 있다 — 탭 줄 안에서는 순서 바꾸기, 창 밖으로 끌어내면 다른 창으로
 * 옮기기다 (`useTabDrag.js`).
 */
export default function TabBar({
  tabs, titleOf, activeId, onSelect, onClose, onAdd, onReorder, onDetach,
  onOpen, onSave, onSaveAs, onSettings,
  recent, onPickRecent, onClearRecent,
}) {
  const barRef = useRef(null)
  const { drag, press, consumeClick } = useTabDrag({ barRef, onReorder, onDetach })

  // 최근 문서 목록이 열린 자리. 단추 오른쪽 끝에 맞춰 아래로 편다
  const recentBtn = useRef(null)
  const [recentAt, setRecentAt] = useState(null)
  const toggleRecent = () => setRecentAt((v) => {
    if (v) return null
    const r = recentBtn.current.getBoundingClientRect()
    return { right: window.innerWidth - r.right, top: r.bottom + 4 }
  })

  return (
    <div className="tabrow">
      <div className="tabbar" ref={barRef}>
        {tabs.map((t, i) => (
          <React.Fragment key={t.id}>
            {drag?.at === i && <span className="tab-ins" />}
            <div
              className={'tab' + (t.id === activeId ? ' on' : '') + (drag?.id === t.id ? ' dragging' : '')}
              onPointerDown={(e) => press(e, t, titleOf(t))}
              onClick={() => { if (!consumeClick()) onSelect(t.id) }}
              onAuxClick={(e) => { if (e.button === 1) onClose(t.id) }}
              title={t.path ?? '저장되지 않음'}
            >
              <span className="tab-name">{titleOf(t)}</span>
              {t.dirty && <span className="tab-dot">●</span>}
              <span className="tab-x" onClick={(e) => { e.stopPropagation(); onClose(t.id) }}>×</span>
            </div>
          </React.Fragment>
        ))}
        {drag?.at === tabs.length && <span className="tab-ins" />}
        <button className="tab-add" onClick={onAdd} title="새 탭 (Ctrl+T)">+</button>
      </div>

      <div className="tab-actions">
        <button onClick={onOpen} title="Open" aria-label="Open"><IconOpen /></button>
        <button ref={recentBtn} onClick={toggleRecent}
                className={recentAt ? 'on' : ''}
                title="최근 문서" aria-label="Recent"><IconRecent /></button>
        <button onClick={onSave} title="Save" aria-label="Save"><IconSave /></button>
        <button onClick={onSaveAs} title="Save As" aria-label="Save As"><IconSaveAs /></button>
        <button onClick={onSettings} title="Settings" aria-label="Settings"><IconGear /></button>
      </div>

      {recentAt && (
        <RecentMenu at={recentAt} items={recent ?? []}
                    onPick={(p) => { setRecentAt(null); onPickRecent(p) }}
                    onClear={() => { setRecentAt(null); onClearRecent() }}
                    onClose={() => setRecentAt(null)} />
      )}

      {/* 끄는 동안 손끝을 따라다니는 이름표. 어디에 놓이는지도 함께 말해 준다 */}
      {drag && (
        <div className="tab-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}>
          {drag.name}
          <span>
            {drag.at !== null ? '여기로 옮기기'
              : drag.out ? '다른 창에 놓으면 그 창으로 · 빈 곳이면 새 창'
              : '탭 줄에 놓으세요'}
          </span>
        </div>
      )}
    </div>
  )
}
