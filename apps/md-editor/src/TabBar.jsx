import React from 'react'
import { IconOpen, IconSave, IconSaveAs, IconGear } from './icons.jsx'

/**
 * 탭과 파일 단추가 한 줄에 있다. 제목줄은 없다 —
 * 문서 제목은 **창 제목(작업 표시줄)** 이 말한다 (`App.jsx`).
 *
 * 탭 쪽만 넘치면 옆으로 밀리고, 오른쪽 단추들은 늘 제자리에 있다.
 */
export default function TabBar({
  tabs, titleOf, activeId, onSelect, onClose, onAdd,
  onOpen, onSave, onSaveAs, onSettings,
}) {
  return (
    <div className="tabrow">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={'tab' + (t.id === activeId ? ' on' : '')}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => { if (e.button === 1) onClose(t.id) }}
            title={t.path ?? '저장되지 않음'}
          >
            <span className="tab-name">{titleOf(t)}</span>
            {t.dirty && <span className="tab-dot">●</span>}
            <span className="tab-x" onClick={(e) => { e.stopPropagation(); onClose(t.id) }}>×</span>
          </div>
        ))}
        <button className="tab-add" onClick={onAdd} title="새 탭 (Ctrl+T)">+</button>
      </div>

      <div className="tab-actions">
        <button onClick={onOpen} title="Open" aria-label="Open"><IconOpen /></button>
        <button onClick={onSave} title="Save" aria-label="Save"><IconSave /></button>
        <button onClick={onSaveAs} title="Save As" aria-label="Save As"><IconSaveAs /></button>
        <button onClick={onSettings} title="Settings" aria-label="Settings"><IconGear /></button>
      </div>
    </div>
  )
}
