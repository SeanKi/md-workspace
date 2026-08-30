import React from 'react'
import { baseName } from './paths.js'

export default function TabBar({ tabs, activeId, onSelect, onClose, onAdd }) {
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab' + (t.id === activeId ? ' on' : '')}
          onClick={() => onSelect(t.id)}
          onAuxClick={(e) => { if (e.button === 1) onClose(t.id) }}
          title={t.path ?? '저장되지 않음'}
        >
          <span className="tab-name">{baseName(t.path)}</span>
          {t.dirty && <span className="tab-dot">●</span>}
          <span className="tab-x" onClick={(e) => { e.stopPropagation(); onClose(t.id) }}>×</span>
        </div>
      ))}
      <button className="tab-add" onClick={onAdd} title="새 탭 (Ctrl+T)">+</button>
    </div>
  )
}
