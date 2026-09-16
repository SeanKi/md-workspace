/**
 * 문서 안의 링크를 따라간다.
 *
 * 위지윅 편집기에서 링크를 **그냥 누르는 것은 글자를 고치려는 것**이다. 그래서
 * 따라가기는 **Ctrl+누르기**(VS Code · 워드와 같다)와 가운데 단추, 그리고 링크를
 * 눌렀을 때 뜨는 풍선 안의 주소를 누르는 것이다. Ctrl 을 누르고 있는 동안에는
 * 링크가 손가락 커서로 바뀌어 "따라갈 수 있다" 는 것이 보인다(`editor.css`).
 *
 * 가리키는 곳은 세 가지다.
 *
 *   `#제목`       같은 문서 안 — 그 제목으로 데려간다
 *   `다른글.md`   이 앱이 연다 — **문서가 있는 폴더 기준**으로 상대 경로를 푼다
 *   그 밖         운영체제에 맡긴다 (`open_external`)
 *
 * 실제로 파일을 여는 일은 앱마다 다르므로 `ctxRef.current.openFile` 로 받는다
 * (MD Notepad 는 새 탭, MDSyncNote 는 오른쪽 노트). 이미지와 같은 ctx 를 쓴다.
 */

import { useEffect } from 'react'
import { $getNearestNodeFromDOMNode } from 'lexical'
import { $isLinkNode } from '@lexical/link'
import { dirOf } from './images.js'
import { invoke, note } from './diag.js'
import { isTauri } from './tauriBridge.js'

/** 이 앱이 직접 여는 것. 나머지는 운영체제에 맡긴다 */
const OPENABLE = /\.(md|markdown|mdx|txt)$/i
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const ABSOLUTE = /^([a-zA-Z]:[\\/]|[\\/])/

const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/** `.` · `..` 를 걷어낸다. 구분자는 `/` 로 맞춘다 (Rust 는 둘 다 받는다) */
function tidy(p) {
  const s = p.replace(/\\/g, '/')
  const lead = s.startsWith('//') ? '//' : (s.startsWith('/') ? '/' : '')
  const out = []
  for (const seg of s.slice(lead.length).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return lead + out.join('/')
}

/**
 * 링크 주소가 무엇을 가리키는지 푼다.
 *
 * @param href    마크다운에 적힌 그대로의 주소
 * @param docPath 지금 문서의 절대 경로 (상대 경로의 기준)
 * @returns {{ kind: 'anchor'|'file'|'external'|'none', target?, anchor? }}
 */
export function resolveHref(href, docPath) {
  const raw = String(href ?? '').trim()
  if (!raw) return { kind: 'none' }
  if (raw.startsWith('#')) return { kind: 'anchor', anchor: decode(raw.slice(1)) }

  // `C:` 는 스킴이 아니라 드라이브다 (스킴은 두 글자 이상)
  const m = SCHEME.exec(raw)
  const scheme = m && m[1].length > 1 ? m[1].toLowerCase() : null
  if (scheme && scheme !== 'file') return { kind: 'external', target: raw }

  let rest = scheme ? raw.replace(/^file:\/{2,}/i, '') : raw
  const hash = rest.indexOf('#')
  const anchor = hash >= 0 ? decode(rest.slice(hash + 1)) : ''
  if (hash >= 0) rest = rest.slice(0, hash)
  const rel = decode(rest.replace(/\?.*$/, ''))
  if (!rel) return anchor ? { kind: 'anchor', anchor } : { kind: 'none' }

  // 상대 경로는 문서가 있는 폴더가 기준이다. 문서를 아직 저장하지 않았으면 기준이 없다
  if (!ABSOLUTE.test(rel) && !docPath) return { kind: 'none' }
  const abs = tidy(ABSOLUTE.test(rel) ? rel : `${dirOf(docPath)}/${rel}`)
  // 확장자가 없으면 마크다운으로 본다 — `[다음 글](02-설치)` 같은 링크가 흔하다
  const target = /\.[^\\/.]+$/.test(abs) ? abs : `${abs}.md`
  return { kind: 'file', target, anchor }
}

/* ---------- 같은 문서 안의 제목으로 ---------- */

/** GitHub 식 앵커 — 소문자, 기호 빼고, 공백은 `-`. 한글은 글자로 남는다 */
const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .replace(/\s+/g, '-')

function revealHeading(anchor) {
  const want = slug(decode(anchor))
  if (!want) return false
  const heads = document.querySelectorAll('.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6')
  const hit = [...heads].find((h) => slug(h.textContent) === want)
  if (!hit) return false
  hit.scrollIntoView({ block: 'start', behavior: 'smooth' })
  // 데려다 놓기만 하면 어디로 왔는지 모른다. 잠깐 표시해 준다
  hit.classList.add('md-jump')
  setTimeout(() => hit.classList.remove('md-jump'), 1400)
  return true
}

/* ---------- 알림 ---------- */

let hintEl = null
let hintTimer = 0

function hint(msg) {
  clearTimeout(hintTimer)
  if (!hintEl) {
    hintEl = document.createElement('div')
    hintEl.className = 'md-cell-hint'
    document.body.appendChild(hintEl)
  }
  hintEl.textContent = msg
  hintTimer = setTimeout(() => { hintEl?.remove(); hintEl = null }, 2600)
}

/* ---------- 따라가기 ---------- */

async function openExternal(target) {
  if (!isTauri) { window.open(target, '_blank', 'noopener'); return }
  try {
    await invoke('open_external', { target })
  } catch (e) {
    // Tauri 호출의 실패는 삼키지 않는다 (CLAUDE.md)
    note(`링크 열기 실패: ${e}`)
    hint(String(e))
  }
}

/** 마크다운에 적힌 그대로의 주소를 따라간다 */
export function followHref(href, ctx) {
  const r = resolveHref(href, ctx?.path)
  if (r.kind === 'none') {
    hint('문서를 먼저 저장해야 상대 경로 링크를 따라갈 수 있습니다')
    return
  }
  if (r.kind === 'anchor') {
    if (!revealHeading(r.anchor)) hint(`문서 안에 "${r.anchor}" 제목이 없습니다`)
    return
  }
  if (r.kind === 'external') { openExternal(r.target); return }
  if (OPENABLE.test(r.target) && ctx?.openFile) { ctx.openFile(r.target); return }
  openExternal(r.target)
}

/* ---------- 설치 ---------- */

// 화면을 나누면 편집기가 둘이 된다. 듣는 자리는 하나면 되고, 두 화면은 같은 문서다
const ctxs = new Set()
const ctxOf = () => [...ctxs][0]?.current ?? null

/**
 * **화면에 그려진 `href` 는 마크다운에 적힌 주소가 아니다.**
 *
 * lexical 의 `formatUrl()`(`@lexical/link`)이 스킴도 없고 `/ # .` 로 시작하지도
 * 않는 주소에 **`https://` 를 붙여서** DOM 에 그린다. `다른글.md` 가 화면에서는
 * `https://다른글.md` 가 되고, `.md` 는 몰도바의 실제 최상위 도메인이라 주소로도
 * 말이 되어 되돌릴 방법이 없다. (`./다른글.md` 와 `#제목` 은 무사하다)
 *
 * 그래서 노드에게 직접 묻는다. 파일로 내보낼 때도 같은 값을 쓰므로
 * (`LexicalLinkVisitor` → `getURL()`) 이것이 진짜 주소다.
 */
function trueHref(a) {
  const editor = a.closest('[contenteditable="true"]')?.__lexicalEditor
  if (!editor?.read) return a.getAttribute('href')
  let url = null
  try {
    editor.read(() => {
      const node = $getNearestNodeFromDOMNode(a)
      if ($isLinkNode(node)) url = node.getURL()
    })
  } catch (e) {
    note(`링크 주소를 읽지 못했습니다: ${e}`)
  }
  return url ?? a.getAttribute('href')
}

/**
 * 본문 안의 링크. Ctrl(또는 가운데 단추)일 때만 따라간다 —
 * 그냥 누르는 것은 링크 글자를 고치려는 것이다.
 *
 * 풍선 안의 주소는 여기서 다루지 않는다. MDXEditor 가 `onClickLinkCallback` 으로
 * **진짜 주소**를 넘겨주므로 그쪽이 더 정확하다 (`Editor.jsx`).
 */
function onClick(e) {
  if (e.button !== 0 && e.button !== 1) return
  const a = e.target?.closest?.('a[href]')
  if (!a || !a.closest('[contenteditable="true"]')) return
  if (!(e.ctrlKey || e.metaKey || e.button === 1)) return

  e.preventDefault()
  e.stopPropagation()
  followHref(trueHref(a), ctxOf())
}

/** Ctrl 을 누르고 있는 동안에는 링크가 따라갈 수 있는 것으로 보인다 */
const setCtrl = (on) => document.body.classList.toggle('md-ctrl', on)
const onKey = (e) => setCtrl(e.ctrlKey || e.metaKey)
const onBlur = () => setCtrl(false)

export function useLinkNav(ctxRef) {
  useEffect(() => {
    ctxs.add(ctxRef)
    if (ctxs.size === 1) {
      document.addEventListener('click', onClick, true)
      document.addEventListener('auxclick', onClick, true)
      window.addEventListener('keydown', onKey)
      window.addEventListener('keyup', onKey)
      window.addEventListener('blur', onBlur)
    }
    return () => {
      ctxs.delete(ctxRef)
      if (ctxs.size) return
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onClick, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
      setCtrl(false)
    }
  }, [ctxRef])
}
