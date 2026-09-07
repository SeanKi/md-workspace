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

export default function Editor({ markdown, onChange, ctxRef, editorRef }) {
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
    diffSourcePlugin({ viewMode: 'rich-text' }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <Separator />
          <BoldItalicUnderlineToggles />
          {/* 취소선만 쓴다. 위첨자·아래첨자는 마크다운이 아니라 <sup>·<sub> 태그로 나가서
              다른 도구에서 그대로 보인다 */}
          <StrikeThroughSupSubToggles options={['Strikethrough']} />
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
  ], [ctxRef])

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
