import React from 'react'
import { normalizeImageDir } from '@md/editor-core'
import WinAssoc from './WinAssoc.jsx'

export default function SettingsBar({ settings, onChange }) {
  const label = normalizeImageDir(settings.imageDir) || '(문서와 같은 폴더)'
  return (
    <div className="settings">
      <div className="row">
        <label>
          이미지 저장 폴더
          <input
            value={settings.imageDir}
            placeholder="images"
            onChange={(e) => onChange({ imageDir: e.target.value })}
          />
        </label>
        <span className="hint">
          문서가 있는 폴더 기준. 비우거나 <code>.</code> 을 넣으면 문서와 같은 폴더에 저장합니다.
          현재: <b>{label}</b>
        </span>
      </div>
      <WinAssoc />
    </div>
  )
}
