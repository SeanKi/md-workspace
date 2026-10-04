// 처음 띄웠을 때(또는 브라우저에서) 보여 줄 견본 — 기능을 한 화면에서 시험해 볼 수 있게
export const SAMPLE = `# Tiptap 시험판

이 문서는 **MDXEditor 를 Tiptap(ProseMirror) 으로 바꿨을 때** 무엇이 되는지 확인하려고 만든 견본이다.
한글을 *빠르게* 쳐 보고, ~~취소선~~, \`인라인 코드\`, <u>밑줄</u>, <span style="color:#e11d48">글자색</span>,
<span style="background-color:#fef08a">배경색</span> 을 확인한다.

## 목록

- 글머리 목록
  - 들여쓴 항목
- [ ] 할 일
- [x] 끝낸 일

1. 번호 목록
2. 두 번째

> 인용문 안의 **굵은 글씨**

## 표

| 이름 | 설명 | 비고 |
|:---|---|--:|
| 셀 안 줄바꿈 | Shift+Enter 로<br />두 줄 | 100 |
| Enter | 아래 칸으로 | 200 |

## 코드

\`\`\`js
const hello = (name) => \`안녕, \${name}\`
\`\`\`

\`\`\`mermaid
graph TD
  A[열기] --> B{고쳤나}
  B -->|아니오| C[원문 그대로 저장]
  B -->|예| D[고친 블록만 새로 씀]
\`\`\`

## 다른 도구가 만든 것

A <- B, p<0.05, \`<br>\` 가 든 문서도 그대로 열린다. [[위키링크]] 와 snake_case_name 도 그대로 둔다.

<details>
<summary>HTML 블록은 원문으로 보인다</summary>

내용
</details>

[참조 링크][ref] 와 각주[^1].

[ref]: https://example.com
[^1]: 각주 내용
`
