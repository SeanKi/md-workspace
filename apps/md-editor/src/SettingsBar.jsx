import React from 'react'
import { normalizeImageDir } from '@md/editor-core'
import WinAssoc from './WinAssoc.jsx'
import SavePdf from './SavePdf.jsx'

export default function SettingsBar({ settings, onChange, path }) {
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
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={!!settings.wideLayout}
            onChange={(e) => onChange({ wideLayout: e.target.checked })}
          />
          본문을 화면 전체 폭으로
        </label>
        <span className="hint">
          끄면 인쇄물처럼 가운데 고정 폭(900px)으로 봅니다. 이 선택은 저장됩니다.
        </span>
      </div>
      <SavePdf path={path} />
      <WinAssoc />
    </div>
  )
}
