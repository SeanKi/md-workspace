# MD Editor

마크다운을 위지윅(WYSIWYG)으로 편집하는 데스크톱 앱.
MDXEditor(에디터) + Tauri v2(데스크톱 셸) 조합.

## 준비물 (최초 1회)

1. **Node.js** 20 이상 — https://nodejs.org
2. **Rust** — https://rustup.rs 에서 `rustup-init.exe` 실행
3. **Visual Studio Build Tools** — "C++를 사용한 데스크톱 개발" 워크로드
   (Rust 설치 중에 안내가 나오면 그대로 따라가면 됩니다)

WebView2는 Windows 11에 기본 포함되어 있어 따로 설치할 필요가 없습니다.

## 실행

```bat
npm install
npm start
```

`npm start` = `tauri dev`. 첫 실행은 Rust 의존성을 컴파일하느라 몇 분 걸리고,
그 다음부터는 몇 초 만에 뜹니다.

## 설치 파일(exe) 만들기

```bat
npm run release
```

결과물: `src-tauri\target\release\bundle\nsis\MD Editor_0.1.0_x64-setup.exe`

## 단축키

| 키 | 동작 |
|---|---|
| Ctrl+N / Ctrl+T | 새 탭 |
| Ctrl+W | 탭 닫기 |
| Ctrl+Tab | 다음 탭 |
| Ctrl+O | 열기 |
| Ctrl+S | 저장 |
| Ctrl+Shift+S | 다른 이름으로 저장 |
| Alt+Enter | **표 셀 안에서 줄바꿈** (커서 자리에서 줄이 나뉜다) |

툴바 오른쪽 끝 버튼으로 **위지윅 / 마크다운 원본 / 변경점 비교** 모드를 전환할 수 있습니다.

### 표 안에서의 Enter

| 키 | 동작 |
|---|---|
| Enter | 아래 셀로 이동 |
| Shift+Enter | 위 셀로 이동 |
| Tab / Shift+Tab | 오른쪽 / 왼쪽 셀로 이동 |
| **Alt+Enter** | **셀 안에서 줄바꿈** |

표 셀 안의 줄바꿈은 마크다운 파일에 `<br />` 로 저장됩니다.
GFM 표는 셀 안에 개행을 담지 못하기 때문이며, GitHub · VS Code · Obsidian 에서
모두 줄바꿈으로 보입니다.

```
| 항목 | 설명            |
| -- | ------------- |
| 가  | 첫줄<br />둘째줄 |
```

## 탭 · 드래그 앤 드롭

- 마크다운 파일을 창에 **끌어다 놓으면 새 탭으로 열린다** (`.md`, `.markdown`, `.mdx`, `.txt`)
- 여러 문서를 탭으로 열고 전환. 수정된 탭은 주황색 점(●)으로 표시
- 탭 닫기는 × 또는 가운데 클릭. 저장하지 않은 변경이 있으면 확인을 묻는다

## 이미지 붙여넣기

에디터에 이미지를 `Ctrl+V` 하면 **문서 옆 `images/` 폴더에 자동 저장되고 링크가 삽입된다.**

    ![image](images/20260828-153012-a3f2.png)

저장 폴더는 상단 `⚙` 버튼에서 바꿀 수 있다.

| 설정값 | 저장 위치 |
|---|---|
| `images` (기본) | 문서 옆 `images/` |
| 비움 또는 `.` | 문서와 같은 폴더 |
| `assets/img` | 문서 옆 `assets/img/` |

마크다운에는 **상대 경로**만 기록되므로 GitHub 등 다른 곳에서도 그대로 보인다.
WebView 는 `file://` 을 직접 읽지 못하기 때문에, 화면에 그릴 때만 파일을 읽어
data URI 로 바꿔 표시한다 (파일 내용은 건드리지 않는다).

## Mermaid 다이어그램

코드블록의 언어를 `mermaid` 로 하면 텍스트 대신 **다이어그램이 바로 그려집니다.**
툴바의 `M` 버튼으로 예제와 함께 삽입할 수 있고, 블록 오른쪽 위 "소스 편집"으로
문법을 고치면 250ms 뒤 다이어그램이 다시 그려집니다. 문법이 틀리면 오류 메시지가
나오고, 고치면 바로 복구됩니다.

    ```mermaid
    graph LR
      A[코드 작성] --> B[빌드]
      B --> C{테스트 통과?}
      C -->|예| D[배포]
      C -->|아니오| A
    ```

저장하면 위처럼 평범한 ` ```mermaid ` 코드블록으로 기록되므로, GitHub 등 다른
곳에서도 그대로 렌더링됩니다.

## 구조

```
src/App.jsx              에디터 UI + 열기/저장 로직 (전부 여기 있음)
src/Editor.jsx           MDXEditor 설정 (플러그인 · 툴바)
src/images.js            이미지 붙여넣기 저장 · 미리보기 변환
src/settings.js          설정 저장 (이미지 폴더)
src/MermaidBlock.jsx     Mermaid 렌더링 플러그인 (코드블록 확장 + 툴바 버튼)
src/styles.css           상단 바 · Mermaid 블록 스타일
src-tauri/src/lib.rs     read_file / write_file / save_binary_b64 / read_binary_base64
src-tauri/tauri.conf.json  창 크기·앱 이름·번들 설정
```

파일 입출력은 Rust 쪽 `read_file` / `write_file` 커맨드 두 개가 전부입니다.
파일 선택 대화상자만 Tauri dialog 플러그인을 씁니다.
