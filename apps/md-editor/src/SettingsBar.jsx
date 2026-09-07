import React, { useEffect, useState } from 'react'
import { normalizeImageDir, logDir } from '@md/editor-core'
import WinAssoc from './WinAssoc.jsx'
import SavePdf from './SavePdf.jsx'

export default function SettingsBar({ settings, onChange, path }) {
  // 화면이 멎었을 때 볼 기록이 어디에 쌓이는지 (평소엔 볼 일이 없다)
  const [logPath, setLogPath] = useState('')
  useEffect(() => { logDir().then(setLogPath).catch(() => {}) }, [])

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
      {logPath && (
        <div className="row">
          <span className="hint">
            화면이 멎었던 기록은 <code>{logPath}</code> 에 날짜별로 쌓입니다
            (숨김 폴더, 2주 뒤 자동 삭제).
          </span>
        </div>
      )}
    </div>
  )
}
