import React, { useEffect, useState } from 'react'
import { normalizeImageDir, logDir } from './core.js'
import { SavePdf, WinAssoc } from './PdfAndAssoc.jsx'

/** 예전 설정(켜고 끄기)도 받는다 — 켜 둔 것은 기본값(원격만)으로 */
export const shrinkMode = (v) => (v === false || v === 'false' || v === 'never' ? 'never' : v === 'always' ? 'always' : 'remote')

/** 톱니바퀴를 눌렀을 때 나오는 설정 줄. */
export default function SettingsBar({ settings, onChange, opsFallbackSec, configPath, docPath, simple }) {
  // 화면이 멎었을 때 볼 기록이 어디에 쌓이는지 알려 준다 (평소엔 볼 일이 없다)
  const [logPath, setLogPath] = useState('')
  useEffect(() => { logDir().then(setLogPath).catch(() => {}) }, [])

  return (
    <div className="settings">
      <label>
        이미지 저장 폴더
        <input value={settings.imageDir} placeholder=".image"
               onChange={(e) => onChange({ imageDir: e.target.value })} />
      </label>
      <label title="1MB 가 넘거나 긴 변이 이보다 큰 그림은 줄여서 WebP 로 저장합니다">
        큰 그림 줄이기
        <select value={shrinkMode(settings.imageShrink)} onChange={(e) => onChange({ imageShrink: e.target.value })}>
          <option value="remote">원격 저장소만</option>
          <option value="always">항상</option>
          <option value="never">안 함</option>
        </select>
        <input type="number" min="640" step="320" style={{ width: 70 }}
               disabled={shrinkMode(settings.imageShrink) === 'never'}
               value={settings.imageMaxSide ?? 2560}
               onChange={(e) => onChange({ imageMaxSide: Number(e.target.value) })} />px
      </label>
      <label>
        자동 저장(초)
        <input type="number" min="0" step="10" style={{ width: 80 }}
               value={settings.autoSaveSec}
               onChange={(e) => onChange({ autoSaveSec: Number(e.target.value) })} />
      </label>
      {/* 단순 모드에는 저장소가 없다 — git · 동기화 설정은 숨긴다 */}
      {!simple && <label className="check">
        <input type="checkbox" checked={!!settings.autoCommit}
               onChange={(e) => onChange({ autoCommit: e.target.checked })} />
        저장할 때 git commit
      </label>}
      <label className="check">
        <input type="checkbox" checked={!!settings.wideLayout}
               onChange={(e) => onChange({ wideLayout: e.target.checked })} />
        본문 전체 폭
      </label>
      <label className="check">
        <input type="checkbox" checked={!!settings.bigDocSource}
               onChange={(e) => onChange({ bigDocSource: e.target.checked })} />
        큰 문서(10만 자 이상)는 원본 모드로 열기 (Tiptap 은 대개 필요 없다)
      </label>
      <span className="hint">
        이미지: 비우거나 <code>.</code> 이면 문서와 같은 폴더 (현재
        <b> {normalizeImageDir(settings.imageDir) || '문서와 같은 폴더'}</b>).
        자동 저장 0 이면 사용 안 함.
        git 커밋은 저장소 폴더가 git 저장소일 때만, 변경이 있을 때만 일어납니다.
        트리에서 한 이름 바꾸기·옮기기·삭제도 같은 간격으로 따로 커밋됩니다
        (자동 저장을 꺼 두면 {opsFallbackSec}초마다).
      </span>
      {configPath && (
        <span className="hint">
          설정과 저장소 목록은 <code>{configPath}</code> 에 있습니다 — 메모장으로 열어 고칠 수 있습니다
          (앱을 닫은 뒤에).
        </span>
      )}
      {!simple && <>
      <div className="row-line">
        <span>동기화</span>
        <label>이 기기 이름
          <input value={settings.deviceName ?? ''} placeholder={settings.deviceId ? `PC-${settings.deviceId.slice(-4)}` : ''}
                 onChange={(e) => onChange({ deviceName: e.target.value })} style={{ width: 120 }} />
        </label>
        <label>내 이름 (이력에 "누가")
          <input value={settings.authorName ?? ''} placeholder="비우면 기기 이름"
                 onChange={(e) => onChange({ authorName: e.target.value })} style={{ width: 120 }} />
        </label>
        <label>자동 동기화(초)
          <input type="number" min="0" step="30" style={{ width: 70 }} value={settings.syncSec ?? 120}
                 onChange={(e) => onChange({ syncSec: Number(e.target.value) })} />
        </label>
        <span className="hint">0 이면 끔 · 저장할 때와 ⟳ 를 누를 때는 늘 맞춘다</span>
      </div>
      </>}
      <SavePdf docPath={docPath} />
      <WinAssoc />
      {logPath && (
        <span className="hint">
          화면이 멎었던 기록은 <code>{logPath}</code> 에 날짜별로 쌓입니다 (숨김 폴더, 2주 뒤 자동 삭제).
        </span>
      )}
    </div>
  )
}
