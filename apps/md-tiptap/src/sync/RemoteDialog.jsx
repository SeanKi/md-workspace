import React, { useEffect, useState } from 'react'
import { probe, findRepos } from '@md/sync-core'
import { isTauri, invoke } from '../core.js'
import { storeFor, setPassword, hasPassword, forgetPassword } from './adapter.js'
import { scanQr } from './QrTransfer.jsx'

/*
 * 원격(WebDAV) 등록 — git 의 remote 처럼.
 *
 *   mode 'connect' : 이미 있는 저장소(로컬 폴더)에 원격을 붙인다 → 첫 동기화가 "올리기" 다
 *   mode 'clone'   : 원격에서 가져온다 → **로컬 캐시 폴더를 꼭 정한다**. 문서는 열 때 받는다
 *
 * Koofr 예: https://app.koofr.net/dav/Koofr/노트 · 사용자는 Koofr 로그인 이메일 ·
 * 비밀번호는 Koofr 설정 → 비밀번호 → "앱 비밀번호" 로 만든 것.
 */

const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent)
// 폰 키보드의 자동 대문자 · 자동 수정을 끈다 — 주소의 대소문자가 바뀌면 다른 폴더가 된다 (Koofr 는 /dav/Koofr/)
const NO_AUTO = { autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off', spellCheck: false }
const lastName = (url) => decodeURIComponent((url.replace(/\/+$/, '').split('/').pop() || '노트'))

export default function RemoteDialog({ mode, repo, known = [], onOk, onCancel, onUnlink }) {
  const [url, setUrl] = useState(repo?.remote ?? '')
  const [user, setUser] = useState(repo?.user ?? '')
  const [pass, setPass] = useState('')
  const [saved, setSaved] = useState(false)
  const [folder, setFolder] = useState(repo?.path ?? '')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  // 저장소 찾기 — 상위 폴더 하나를 넣으면 그 아래 동기화 저장소들을 골라 한꺼번에 가져온다
  const [found, setFound] = useState(null)     // [{ name, remote, have }]
  const [picked, setPicked] = useState(() => new Set())
  const clone = mode === 'clone'
  const base = url.trim().replace(/\/+$/, '')
  const isKnown = (remote) => known.some((k) => k.remote.replace(/\/+$/, '').toLowerCase() === remote.toLowerCase())
  // 이미 쓰는 주소 — 골라서 끝만 고치면 된다 (같은 계정이면 비밀번호도 저장돼 있다)
  const choices = known.filter((k, i) => known.findIndex((x) => x.remote === k.remote && x.user === k.user) === i)

  /**
   * PC 의 QR 을 읽는다 (저장소 줄의 QR 단추). 비밀번호는 바로 넣어 둔다.
   * 원격 연결: 칸을 채운다 → [연결] · 가져오기: 바로 가져온다
   */
  const scan = async () => {
    setResult(null)
    try {
      const got = await scanQr()
      if (!got) return
      for (const [account, password] of Object.entries(got.creds)) await invoke('cred_set', { account, password })
      if (clone) { setBusy(true); await onOk({ items: got.items }); return }
      const it = got.items.find((x) => x.name === repo?.name) ?? got.items[0]
      if (it) { setUrl(it.remote); setUser(it.user); setPass('') }
    } catch (e) {
      setResult({ ok: false, steps: [{ name: 'QR 읽기', ok: false, note: String(e?.message ?? e) }] })
    } finally { setBusy(false) }
  }

  // 같은 서버 · 같은 사용자의 비밀번호가 이미 있으면 다시 묻지 않는다 (다른 저장소에서 넣어 둔 것)
  useEffect(() => {
    if (!isTauri || !/^https?:\/\/[^/]+/i.test(url.trim()) || !user.trim()) { setSaved(false); return }
    const t = setTimeout(() => {
      hasPassword({ remote: url.trim(), user: user.trim() }).then(setSaved).catch(() => setSaved(false))
    }, 250)
    return () => clearTimeout(t)
  }, [url, user])

  const draft = () => ({ ...(repo ?? {}), remote: url.trim().replace(/\/+$/, ''), user: user.trim(), path: folder })
  const canTalk = /^https?:\/\/[^/]+/i.test(url.trim()) && user.trim() && (pass || saved)
  const valid = canTalk && (!clone || folder || IS_MOBILE) && (!found || picked.size > 0)

  const keepPassword = async (r) => { if (pass) await setPassword(r, pass) }

  const test = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = draft()
      await keepPassword(r)
      setResult(await probe(storeFor(r)))
    } catch (e) {
      setResult({ ok: false, steps: [{ name: '연결', ok: false, note: String(e?.message ?? e) }] })
    }
    setBusy(false)
  }

  const search = async () => {
    setBusy(true)
    setResult(null)
    setFound(null)
    try {
      const r = draft()
      await keepPassword(r)
      const list = (await findRepos(storeFor(r))).map((f) => {
        const remote = f.self ? base : `${base}/${f.name}`
        return { name: f.self ? lastName(base) : f.name, remote, have: isKnown(remote) }
      })
      setFound(list)
      setPicked(new Set(list.filter((f) => !f.have).map((f) => f.remote)))
      if (!list.length) setResult({ ok: false, steps: [{ name: '저장소 찾기', ok: false, note: '이 주소 아래에 동기화 저장소가 없습니다 — 주소를 확인하세요' }] })
    } catch (e) {
      setResult({ ok: false, steps: [{ name: '저장소 찾기', ok: false, note: String(e?.message ?? e) }] })
    }
    setBusy(false)
  }

  const pickFolder = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const p = await open({ directory: true, multiple: false, title: '로컬 캐시 폴더' })
    const path = typeof p === 'string' ? p : p?.path
    if (path) setFolder(path)
  }

  const ok = async () => {
    setBusy(true)
    try {
      const r = draft()
      await keepPassword(r)
      if (clone && found) {
        // 고른 것 여럿 — PC 는 고른 폴더 아래에 저장소 이름으로 하나씩
        await onOk({ items: found.filter((f) => picked.has(f.remote)).map((f) => ({ remote: f.remote, user: r.user, name: f.name })), parent: folder })
      } else {
        await onOk({ remote: r.remote, user: r.user, path: folder, name: repo?.name ?? lastName(r.remote) })
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-back">
      <div className="modal remote-dialog">
        <div className="modal-title">{clone ? '원격에서 가져오기' : `원격 연결 — ${repo?.name ?? ''}`}</div>
        <p className="modal-body">
          {clone
            ? '원격의 문서 목록만 먼저 받습니다. 문서는 열 때 그 문서만 내려받아 로컬 캐시 폴더에 둡니다.'
            : '이 저장소를 원격과 맞춥니다. 처음 맞출 때 이 폴더의 문서를 원격에 올립니다.'}
        </p>
        {/* 폰은 치기 어렵다 — PC 화면의 QR 을 읽으면 저장소와 비밀번호가 한꺼번에 들어온다 */}
        {IS_MOBILE && isTauri && (
          <div className="qr-scan">
            <button type="button" className="primary" disabled={busy} onClick={scan}>📷 PC 화면의 QR 읽기</button>
            <span className="hint">PC 에서 그 저장소 줄의 <b>QR</b> 단추를 누르면 나옵니다{clone ? '' : ' — 칸이 채워지면 [연결]'}</span>
          </div>
        )}
        {choices.length > 0 && (
          <label>이미 쓰는 주소에서 고르기
            <select value="" onChange={(e) => {
              const k = choices[Number(e.target.value)]
              if (k) { setUrl(k.remote); setUser(k.user); setFound(null) }
            }}>
              <option value="">— 골라서 끝만 고치세요 —</option>
              {choices.map((k, i) => <option key={i} value={i}>{k.remote} ({k.user})</option>)}
            </select>
          </label>
        )}
        <label>{clone ? 'WebDAV 주소 — 저장소 하나, 또는 저장소들이 든 상위 폴더' : 'WebDAV 주소'}
          <input value={url} onChange={(e) => { setUrl(e.target.value); setFound(null) }} placeholder="https://app.koofr.net/dav/Koofr/노트" {...NO_AUTO} inputMode="url" />
        </label>
        <label>사용자
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="로그인 이메일" {...NO_AUTO} inputMode="email" />
        </label>
        <label>비밀번호
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                 placeholder={saved ? '저장되어 있음 — 바꿀 때만 입력' : 'Koofr 는 앱 비밀번호'} />
        </label>
        {found && found.length > 0 && (
          <div className="found-repos">
            {found.map((f) => (
              <label key={f.remote} className="check">
                <input type="checkbox" disabled={f.have} checked={f.have || picked.has(f.remote)}
                       onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.remote); else n.delete(f.remote); return n })} />
                {f.name}{f.have ? ' — 이미 있음' : ''}
              </label>
            ))}
          </div>
        )}
        <label>{found ? '로컬 캐시 폴더 — 이 아래에 저장소 이름으로 하나씩' : '로컬 캐시 폴더'}
          {clone && !IS_MOBILE ? (
            <span className="pick">
              <input value={folder} readOnly placeholder="받은 문서를 둘 폴더 (빈 폴더 권장)" />
              <button type="button" onClick={pickFolder}>찾아보기</button>
            </span>
          ) : (
            <input value={IS_MOBILE && clone ? '앱 안에 만듭니다' : folder} readOnly />
          )}
        </label>
        <div className="hint">비밀번호는 설정 파일에 쓰지 않고 Windows 자격 증명 관리자에 둡니다.</div>

        {result && (
          <ul className={`probe ${result.ok ? 'ok' : 'bad'}`}>
            {result.steps.map((s) => <li key={s.name}>{s.ok ? '✓' : '✕'} {s.name}{s.note ? ` — ${s.note}` : ''}</li>)}
            {result.ok && <li>✓ 이 서버로 동기화할 수 있습니다</li>}
          </ul>
        )}

        <div className="modal-row">
          <button type="button" onClick={test} disabled={!canTalk || busy || !isTauri}>연결 시험</button>
          {clone && <button type="button" onClick={search} disabled={!canTalk || busy || !isTauri}>저장소 찾기</button>}
          <span className="spacer" />
          {onUnlink && repo?.remote && (
            <button type="button" className="danger" onClick={async () => { await forgetPassword(repo).catch(() => {}); onUnlink() }}>원격 해제</button>
          )}
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="primary" onClick={ok} disabled={!valid || busy}>{clone ? (found ? `${picked.size}개 가져오기` : '가져오기') : '연결'}</button>
        </div>
      </div>
    </div>
  )
}
