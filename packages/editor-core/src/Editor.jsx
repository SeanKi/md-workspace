import React, { useMemo } from 'react'
import {
  MDXEditor,
  headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin,
  linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin,
  markdownShortcutPlugin, codeBlockPlugin, codeMirrorPlugin,
  diffSourcePlugin, toolbarPlugin,
  UndoRedo, BoldItalicUnderlineToggles, StrikeThroughSupSubToggles,
  BlockTypeSelect, ListsToggle,
  CreateLink, InsertTable, InsertThematicBreak, InsertCodeBlock, InsertImage,
  DiffSourceToggleWrapper, Separator,
} from '@mdxeditor/editor'
import { mermaidDescriptor, InsertMermaid } from './MermaidBlock.jsx'
import { tableCellBreakPlugin } from './tableCellBreak.jsx'
import { uploadImage, previewImage } from './images.js'
import { useTableCellSelect } from './tableSelect.js'
import { useLinkNav, followHref } from './linkNav.js'
import { TextColor, BackColor } from './colorTools.jsx'

export default function Editor({ markdown, onChange, onError, ctxRef, editorRef, viewMode = 'rich-text' }) {
  useTableCellSelect()
  // 문서 안의 링크를 Ctrl+누르기로 따라간다 (`linkNav.js`)
  useLinkNav(ctxRef)

  // ctxRef 는 항상 최신 { path, imageDir } 을 들고 있으므로
  // plugins 배열은 한 번만 만들어도 된다.
  const plugins = useMemo(() => [
    headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
    linkPlugin(),
    // 풍선 안의 주소를 누르면 여기로 온다. 넘어오는 값은 **마크다운에 적힌 그대로**라
    // 화면의 href 보다 정확하다 (lexical 이 href 에 `https://` 를 붙인다 — `linkNav.js`)
    linkDialogPlugin({ onClickLinkCallback: (url) => followHref(url, ctxRef.current) }),
    tablePlugin(), tableCellBreakPlugin(),
    imagePlugin({
      imageUploadHandler: (file) => uploadImage(file, ctxRef.current),
      imagePreviewHandler: (src) => previewImage(src, ctxRef.current),
    }),
    codeBlockPlugin({
      defaultCodeBlockLanguage: 'txt',
      codeBlockEditorDescriptors: [mermaidDescriptor],
    }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        txt: 'Text', js: 'JavaScript', ts: 'TypeScript',
        python: 'Python', bash: 'Bash', json: 'JSON', sql: 'SQL',
      },
    }),
    markdownShortcutPlugin(),
    // 큰 문서는 원본 모드로 여는 길을 준다 — 위지윅은 글자마다 문서 전체를
    // 다시 셈해서 한 글자에 0.6초가 든다(원본 모드는 0.014초). `bigDoc.js` 참고
    diffSourcePlugin({ viewMode }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <Separator />
          <BoldItalicUnderlineToggles />
          {/* 취소선만 쓴다. 위첨자·아래첨자는 마크다운이 아니라 <sup>·<sub> 태그로 나가서
              다른 도구에서 그대로 보인다 */}
          <StrikeThroughSupSubToggles options={['Strikethrough']} />
          {/* 색은 마크다운에 없다. 인라인 HTML(`<span style>`)로 넣는다 */}
          <TextColor />
          <BackColor />
          <Separator />
          <BlockTypeSelect />
          <ListsToggle />
          <Separator />
          <CreateLink />
          <InsertTable />
          <InsertImage />
          <InsertCodeBlock />
          <InsertMermaid />
          <InsertThematicBreak />
        </DiffSourceToggleWrapper>
      ),
    }),
  ], [ctxRef, viewMode])

  return (
    <MDXEditor
      ref={editorRef}
      markdown={markdown}
      plugins={plugins}
      onChange={onChange}
      // 위지윅으로 읽지 못한 문서. MDXEditor 는 여기서 던지지 않고 알려만 주며
      // 원본 글자는 그대로 들고 있다 — 그래서 원본 모드로는 열 수 있다 (`App.jsx`)
      onError={onError}
      contentEditableClassName="prose"
    />
  )
}
