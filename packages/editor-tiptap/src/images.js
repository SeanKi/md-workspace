import { TextSelection } from '@tiptap/pm/state'
import { invoke, note } from '@md/editor-core/src/diag.js'
import { isTauri } from '@md/editor-core/src/tauriBridge.js'
import { dirOf, previewImage } from '@md/editor-core/src/images.js'

/*
 * 이미지 = **저장 경로**(마크다운에 적는 상대 경로)와 **표시 URL**(data URI)을 나눈다.
 * CLAUDE.md "이미지는 저장 경로와 표시 URL 을 분리한다" 그대로.
 *
 * 저장 위치는 문서 옆의 `.image/`. editor-core 의 `normalizeImageDir` 는 앞의 점을
 * 떼어 버리므로 여기서는 쓰지 않는다.
 */

export const IMAGE_DIR = '.image'

const extOf = (n) => (n.split('.').pop() || '').toLowerCase()

function stamp() {
  const d = new Date()
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}` +
    `-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`
}

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** `./.image/` · `.image\` → `.image`. 앞의 점은 살린다 */
const cleanDir = (v) => String(v ?? IMAGE_DIR).trim().replace(/^\.[\\/]+/, '').replace(/[\\/]+$/, '')

/** 이보다 크면 줄인다 (바이트) — 화면 캡처 대부분은 이 아래라 그대로 남는다 */
const SHRINK_OVER = 1_000_000
const DEFAULT_MAX_SIDE = 2560

/**
 * 큰 그림은 줄여서 넣는다 — 폰으로 찍은 사진을 붙이면 클립보드가 PNG 로 바꿔 주어 20MB 가 넘는다.
 * 그대로 두면 동기화가 오래 걸리고(실제로 22MB 가 시간 초과로 밀렸다) 폰에서 그리는 것도 무겁다.
 *
 *   - 1MB 넘거나 긴 변이 maxSide 넘으면 → 긴 변 maxSide 로 줄여 **WebP 85%**
 *   - 줄인 것이 오히려 크면 원래 것을 쓴다 (단색 도식 같은 PNG)
 *   - SVG · GIF(움직임) 는 손대지 않는다
 * WebP 는 VS Code · Obsidian · GitHub · 브라우저가 모두 그린다.
 */
export async function shrinkImage(file, { maxSide = DEFAULT_MAX_SIDE, quality = 0.85 } = {}) {
  if (!/^image\/(png|jpeg|webp|bmp|avif)$/i.test(file.type || '')) return file
  let bmp
  try { bmp = await createImageBitmap(file) } catch { return file }
  const long = Math.max(bmp.width, bmp.height)
  if (file.size <= SHRINK_OVER && long <= maxSide) { bmp.close?.(); return file }
  const k = Math.min(1, maxSide / long)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality))
  if (!blob || blob.size >= file.size) return file
  note(`그림 줄임 ${Math.round(file.size / 1024)}KB → ${Math.round(blob.size / 1024)}KB (${canvas.width}×${canvas.height})`)
  return new File([blob], (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' })
}

/** 이미지 파일을 문서 옆에 저장하고 마크다운에 적을 상대 경로를 돌려준다 */
export async function saveImage(file, ctx) {
  // 브라우저에서는 파일을 쓸 수 없다 — 이 세션 동안만 보이는 주소로
  if (!isTauri) return URL.createObjectURL(file)
  const docPath = ctx?.path ?? await ctx?.ensureSaved?.()
  if (!docPath) throw new Error('먼저 문서를 저장한 뒤 이미지를 넣어 주세요.')
  // 설정에서 끌 수 있다 (imageShrink = false)
  if (ctx.imageShrink !== false) file = await shrinkImage(file, { maxSide: Number(ctx.imageMaxSide) || DEFAULT_MAX_SIDE })
  let ext = extOf(file.name || '')
  if (!ext || ext.length > 5) ext = (file.type || '').split('/')[1] || 'png'
  const sub = cleanDir(ctx.imageDir)
  const rel = sub ? `${sub}/${stamp()}.${ext}` : `${stamp()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  await invoke('save_binary_b64', { path: `${dirOf(docPath)}/${rel}`, b64: toBase64(bytes) })
  return rel
}

/**
 * 화면에 그릴 주소. 원격이 붙은 저장소에서는 그림이 캐시에 아직 없을 수 있다 —
 * 그때는 앱이 원격에서 받아 오게 하고(`ctx.fetchImage`) 그 다음에 그린다
 */
export async function showImage(src, ctx) {
  ctx = ctx ?? {}
  if (isTauri && ctx.fetchImage && ctx.path && src && !/^(https?:|data:|blob:)/i.test(src)) {
    const abs = /^([a-zA-Z]:[\\/]|[\\/])/.test(src) ? src : `${dirOf(ctx.path)}/${src}`
    if (!(await invoke('stat_file', { path: abs }).catch(() => null))) await ctx.fetchImage(abs)
  }
  return previewImage(src, ctx)
}

async function insertImages(view, files, ctx) {
  for (const f of files) {
    try {
      const src = await saveImage(f, ctx)
      const node = view.state.schema.nodes.image.create({ src, alt: '' })
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
    } catch (e) {
      // 실패를 삼키지 않는다 (CLAUDE.md)
      note(`이미지 넣기 실패: ${e?.message ?? e}`)
      alert(`이미지를 넣지 못했습니다.\n${e?.message ?? e}`)
    }
  }
}

const imagesOf = (list) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'))

/**
 * 붙여넣기. 글자(text/plain)가 같이 있으면 글자를 붙인다 — 엑셀 칸을 복사해도
 * 표 그림이 딸려 온다 (editor-core/imagePaste.js 와 같은 판단)
 */
export function handleImagePaste(view, event, ctx) {
  const dt = event.clipboardData
  const files = imagesOf(dt?.files)
  if (!files.length || dt.types.includes('text/plain')) return false
  event.preventDefault()
  insertImages(view, files, ctx)
  return true
}

/** 브라우저(웹)에서 끌어다 놓기. Tauri 창에서는 OS 가 드롭을 가로채므로 오지 않는다 */
export function handleImageDrop(view, event, ctx) {
  const files = imagesOf(event.dataTransfer?.files)
  if (!files.length) return false
  event.preventDefault()
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))))
  insertImages(view, files, ctx)
  return true
}

export function pickImages(view, ctx) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => insertImages(view, imagesOf(input.files), ctx)
  input.click()
}

/** 이미지 노드 뷰 — 화면에만 data URI 를 쓰고 노드의 src 는 그대로 둔다 */
/** 그림을 못 그렸을 때 다시 해 보는 간격(ms) — 다른 기기가 아직 올리는 중일 수 있다 */
const RETRY_MS = [5_000, 15_000, 30_000, 60_000, 120_000]

export const imageView = (getCtx) => () => ({ node }) => {
  const img = document.createElement('img')
  let src = null
  let timer = 0
  let tries = 0
  const load = () => {
    const want = src
    showImage(want, getCtx()).then((url) => {
      if (want !== src) return
      img.src = url
      // 원격에서 아직 못 받았으면(그쪽이 올리는 중이거나 연결이 끊겼다) 조금 뒤 다시 —
      // 열어 둔 문서의 그림이 받아지는 대로 저절로 나타나게
      const local = /^(data:|blob:|https?:)/i.test(url ?? '')
      if (!local && tries < RETRY_MS.length) timer = setTimeout(load, RETRY_MS[tries++])
    })
  }
  const set = (n) => {
    img.alt = n.attrs.alt ?? ''
    img.title = n.attrs.title ?? n.attrs.src ?? ''
    if (n.attrs.src === src) return
    src = n.attrs.src
    clearTimeout(timer)
    tries = 0
    load()
  }
  set(node)
  return {
    dom: img,
    update: (n) => (n.type.name === 'image' ? (set(n), true) : false),
    destroy: () => clearTimeout(timer),
  }
}
