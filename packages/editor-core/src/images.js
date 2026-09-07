import { invoke } from './diag.js'
import { isTauri } from './tauriBridge.js'

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}

export const dirOf = (p) => (p ? p.replace(/[\\/][^\\/]*$/, '') : '')
const extOf = (n) => (n.split('.').pop() || '').toLowerCase()
const isAbsolute = (p) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p)

function stamp() {
  const d = new Date()
  const z = (n) => String(n).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6)
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}` +
         `-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${rand}`
}

function toBase64(bytes) {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

/** 설정값을 실제 하위 폴더명으로 정규화. '' / '.' / './' → 문서와 같은 폴더 */
export function normalizeImageDir(v) {
  return String(v ?? '').trim().replace(/^[.\\/]+/, '').replace(/[\\/]+$/, '')
}

/**
 * 붙여넣기·드롭한 이미지를 문서 옆에 저장하고, 마크다운에 넣을 상대 경로를 돌려준다.
 * 저장 위치는 설정(imageDir)에 따라 동적으로 결정된다.
 */
export async function uploadImage(file, ctx) {
  if (!isTauri) return URL.createObjectURL(file)   // 브라우저 개발 모드 폴백
  if (!ctx.path) throw new Error('먼저 문서를 저장한 뒤 이미지를 붙여넣어 주세요.')

  let ext = extOf(file.name || '')
  if (!ext || ext.length > 5) ext = (file.type || '').split('/')[1] || 'png'

  const sub = normalizeImageDir(ctx.imageDir)
  const rel = sub ? `${sub}/${stamp()}.${ext}` : `${stamp()}.${ext}`
  const abs = `${dirOf(ctx.path)}/${rel}`

  const bytes = new Uint8Array(await file.arrayBuffer())
  await invoke('save_binary_b64', { path: abs, b64: toBase64(bytes) })

  cache.delete(abs)
  return rel
}

const cache = new Map()

/**
 * 마크다운에는 상대 경로를 그대로 두고, 화면에 그릴 때만 실제 데이터로 바꾼다.
 * WebView 는 file:// 을 직접 읽지 못하므로 data URI 로 변환한다.
 */
export async function previewImage(src, ctx) {
  if (!src) return src
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  if (!isTauri || !ctx.path) return src

  const abs = isAbsolute(src) ? src : `${dirOf(ctx.path)}/${src}`
  if (cache.has(abs)) return cache.get(abs)

  try {
    const b64 = await invoke('read_binary_base64', { path: abs })
    const url = `data:${MIME[extOf(abs)] || 'application/octet-stream'};base64,${b64}`
    cache.set(abs, url)
    return url
  } catch {
    return src   // 없는 파일이면 원래 경로를 그대로 (깨진 이미지로 보임)
  }
}
