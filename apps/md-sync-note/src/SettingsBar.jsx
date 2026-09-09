import React, { useEffect, useState } from 'react'
import { normalizeImageDir, logDir } from '@md/editor-core'
import { mdNotepadPath, pickMdNotepad } from './shell.js'

/** 톱니바퀴를 눌렀을 때 나오는 설정 줄. */
export default function SettingsBar({ settings, onChange, opsFallbackSec, configPath }) {
  // 화면이 멎었을 때 볼 기록이 어디에 쌓이는지 알려 준다 (평소엔 볼 일이 없다)
  const [logPath, setLogPath] = useState('')
  useEffect(() => { logDir().then(setLogPath).catch(() => {}) }, [])

  // 트리에서 "MD Notepad 로 열기" 가 실제로 어느 것을 쓰는지 보여 준다.
  // 못 찾으면 여기서 한 번 골라 두면 된다
  const [found, setFound] = useState('')
  useEffect(() => { mdNotepadPath(settings.editorPath).then(setFound).catch(() => setFound('')) },
    [settings.editorPath])

  return (
    <div className="settings">
      <label>
        이미지 저장 폴더
        <input value={settings.imageDir} placeholder="images"
               onChange={(e) => onChange({ imageDir: e.target.value })} />
      </label>
      <label>
        자동 저장(초)
        <input type="number" min="0" step="10" style={{ width: 80 }}
               value={settings.autoSaveSec}
               onChange={(e) => onChange({ autoSaveSec: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={!!settings.autoCommit}
               onChange={(e) => onChange({ autoCommit: e.target.checked })} />
        저장할 때 git commit
      </label>
      <label className="check">
        <input type="checkbox" checked={!!settings.wideLayout}
               onChange={(e) => onChange({ wideLayout: e.target.checked })} />
        본문 전체 폭
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.bigDocSource !== false}
               onChange={(e) => onChange({ bigDocSource: e.target.checked })} />
        큰 문서(10만 자 이상)는 원본 모드로 열기
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
      <div className="row-line">
        <span>MD Notepad</span>
        <code className={found ? '' : 'missing'}>{found || '찾지 못했습니다'}</code>
        <button type="button" onClick={async () => {
          const p = await pickMdNotepad()
          if (p) onChange({ editorPath: p })
        }}>찾아보기</button>
        {settings.editorPath && (
          <button type="button" onClick={() => onChange({ editorPath: '' })}>자동으로</button>
        )}
      </div>
      {logPath && (
        <span className="hint">
          화면이 멎었던 기록은 <code>{logPath}</code> 에 날짜별로 쌓입니다 (숨김 폴더, 2주 뒤 자동 삭제).
        </span>
      )}
    </div>
  )
}
