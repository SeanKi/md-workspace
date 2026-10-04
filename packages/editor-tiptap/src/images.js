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

/** 이미지 파일을 문서 옆에 저장하고 마크다운에 적을 상대 경로를 돌려준다 */
export async function saveImage(file, ctx) {
  // 브라우저에서는 파일을 쓸 수 없다 — 이 세션 동안만 보이는 주소로
  if (!isTauri) return URL.createObjectURL(file)
  const docPath = ctx?.path ?? await ctx?.ensureSaved?.()
  if (!docPath) throw new Error('먼저 문서를 저장한 뒤 이미지를 넣어 주세요.')
  let ext = extOf(file.name || '')
  if (!ext || ext.length > 5) ext = (file.type || '').split('/')[1] || 'png'
  const sub = cleanDir(ctx.imageDir)
  const rel = sub ? `${sub}/${stamp()}.${ext}` : `${stamp()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  await invoke('save_binary_b64', { path: `${dirOf(docPath)}/${rel}`, b64: toBase64(bytes) })
  return rel
}

export const showImage = (src, ctx) => previewImage(src, ctx ?? {})

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
export const imageView = (getCtx) => () => ({ node }) => {
  const img = document.createElement('img')
  let src = null
  const set = (n) => {
    img.alt = n.attrs.alt ?? ''
    img.title = n.attrs.title ?? n.attrs.src ?? ''
    if (n.attrs.src === src) return
    src = n.attrs.src
    showImage(src, getCtx()).then((url) => { if (src === n.attrs.src) img.src = url })
  }
  set(node)
  return {
    dom: img,
    update: (n) => (n.type.name === 'image' ? (set(n), true) : false),
  }
}
