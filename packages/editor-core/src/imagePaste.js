// 클립보드의 이미지를 붙여넣는다.
//
// MDXEditor 도 붙여넣기를 받지만 두 군데서 놓친다.
//
// 1. 클립보드에 이미지 **말고 다른 것이 하나라도** 같이 있으면 손을 뗀다
//    (`isMixedPayload`). 브라우저의 "이미지 복사" 는 image/png 와 함께 <img> 를 담은
//    text/html 을 올린다 — 그러면 lexical 이 HTML 을 붙여 원격 주소의 그림이 되거나
//    아무것도 안 들어간다.
// 2. 올리기가 실패하면 promise 안에서 `throw` 해 **조용히 사라진다.** 저장하지 않은
//    새 문서에서 캡처를 붙이면 아무 일도 안 일어나는 것이 이것이다.
//
// 그래서 같은 큐의 맨 앞(BEFORE_CRITICAL)에서 먼저 받는다.
// text/plain 이 함께 있으면 손대지 않는다 — 엑셀 칸을 복사하면 표 그림(image/png)도
// 같이 올라오는데, 그때 바라는 것은 글자다.

import { COMMAND_PRIORITY_BEFORE_CRITICAL, PASTE_COMMAND } from 'lexical'
import { INSERT_IMAGE_COMMAND, createRootEditorSubscription$, realmPlugin } from '@mdxeditor/editor'

function imageFiles(data) {
  if (!data) return []
  const items = Array.from(data.items ?? [])
  if (items.some((i) => i.kind === 'string' && i.type === 'text/plain')) return []
  return items
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean)
}

/** `upload(file) → 마크다운에 적을 경로`, `onError(e)` 는 실패를 알린다 */
export const imagePastePlugin = realmPlugin({
  init(realm, { upload, onError }) {
    realm.pub(createRootEditorSubscription$, (editor) =>
      editor.registerCommand(PASTE_COMMAND, (event) => {
        const files = imageFiles(event?.clipboardData)
        if (files.length === 0) return false
        event.preventDefault()
        ;(async () => {
          try {
            for (const f of files) {
              const src = await upload(f)
              if (src) editor.dispatchCommand(INSERT_IMAGE_COMMAND, { src, altText: '' })
            }
          } catch (e) {
            onError(e)
          }
        })()
        return true
      }, COMMAND_PRIORITY_BEFORE_CRITICAL))
  },
})
