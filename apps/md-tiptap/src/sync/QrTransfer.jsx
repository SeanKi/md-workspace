import React, { useEffect, useState } from 'react'
import { invoke } from '../core.js'

/*
 * PC → 폰으로 저장소 설정 넘기기 (transfer.rs).
 *
 *   PC  : 📱 단추 → 원격이 붙은 저장소의 주소 · 사용자 · 저장해 둔 비밀번호를 담은 QR
 *   폰  : ☁ 가져오기 → 📷 QR 읽기 → 저장소를 모두 더하고 비밀번호도 넣는다
 *
 * 폰에서 주소 · 이메일 · 앱 비밀번호를 치지 않게 하려는 것이다.
 */

const PREFIX = 'MDNP1:'

/** PC — QR 을 보여 준다. QR 은 Rust 가 SVG 로 그린다 (비밀번호가 화면 코드에 글자로 오지 않게) */
export function SendQr({ repos, onClose }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    invoke('transfer_qr', { repos: repos.map((r) => ({ name: r.name, remote: r.remote, user: r.user ?? '' })) })
      .then(setSvg).catch((e) => setError(String(e)))
  }, [repos])
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal qr-send" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">폰으로 보내기 — {repos.map((r) => r.name).join(', ')}</div>
        <p className="modal-body">
          폰에서 <b>원격 연결</b>(이미 있는 저장소에 붙일 때) 또는 <b>☁ 가져오기</b>(새로 받을 때)의
          <b>📷 QR 읽기</b> 를 누르고 이 화면을 비추세요. <b>{repos.map((r) => r.name).join(', ')}</b> 의 주소 · 사용자 · 비밀번호가 넘어갑니다.
        </p>
        {error ? <div className="hint bad">{error}</div>
          : svg ? <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="hint">만드는 중…</div>}
        <div className="hint bad">이 QR 에는 비밀번호가 들어 있습니다 — 다 읽으면 바로 닫고, 남에게 보이지 마세요.</div>
        <div className="modal-row"><span className="spacer" /><button type="button" className="primary" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  )
}

/**
 * 폰 — 카메라로 QR 을 읽어 { items: [{ name, remote, user }], creds: { 계정: 비밀번호 } } 를 돌려준다.
 * 취소하면 null
 */
export async function scanQr() {
  const bs = await import('@tauri-apps/plugin-barcode-scanner')
  let perm = await bs.checkPermissions()
  if (perm !== 'granted') perm = await bs.requestPermissions()
  if (perm !== 'granted') throw new Error('카메라 권한이 없습니다 — 설정에서 카메라를 허용해 주세요')
  const got = await bs.scan({ windowed: false, formats: [bs.Format.QRCode] })
  const text = got?.content ?? ''
  if (!text) return null
  if (!text.startsWith(PREFIX)) throw new Error('MDNotePad+ 의 QR 이 아닙니다 — PC 저장소 줄의 QR 단추로 나온 QR 을 비추세요')
  const data = JSON.parse(text.slice(PREFIX.length))
  return {
    items: (data.r ?? []).map(([name, remote, user]) => ({ name, remote, user })),
    creds: data.p ?? {},
  }
}
