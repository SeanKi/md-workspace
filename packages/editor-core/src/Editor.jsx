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
import { TextColor, BackColor } from './colorTools.jsx'

export default function Editor({ markdown, onChange, ctxRef, editorRef, viewMode = 'rich-text' }) {
  useTableCellSelect()

  // ctxRef 는 항상 최신 { path, imageDir } 을 들고 있으므로
  // plugins 배열은 한 번만 만들어도 된다.
  const plugins = useMemo(() => [
    headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
    linkPlugin(), linkDialogPlugin(), tablePlugin(), tableCellBreakPlugin(),
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
      contentEditableClassName="prose"
    />
  )
}
