# MDNotePad+

**마크다운을 눈에 보이는 모습 그대로 편집하고, 필요할 때 PC와 Android에서 맞춰 쓰는 노트 앱입니다.**

Windows에서는 **MDNotePad+.exe 하나**로 두 가지 모드를 사용합니다. 그냥 실행하면 문서 편집에 집중하는 **MDNotePad+**, `--sync`를 붙이면 폴더와 원격 저장소를 관리하는 **MDNotePad+(동기화 모드)**가 됩니다. Android에서는 동기화 모드로 실행됩니다.

문서는 실제 `.md` 파일로 저장하므로 VS Code, Obsidian, GitHub 등에서도 열 수 있습니다.

**현재 Windows 버전: 1.16.5** · [최신 릴리스](https://github.com/SeanKi/md-workspace/releases/latest) · [변경 이력](https://github.com/SeanKi/md-workspace/blob/tiptap-spike/docs/Update_History.md)

## 다운로드와 실행

| 종류 | 다운로드 | 실행 방법 |
|---|---|---|
| **MDNotePad+ 1.16.5** | [MDNotePad+.exe](https://github.com/SeanKi/md-workspace/releases/download/v1.16.5/MDNotePad%2B.exe) | Windows에서 받아서 실행합니다. 설치가 필요 없습니다. |
| **MDNotePad+(동기화 모드) 1.16.5** | 위와 같은 실행 파일 | 바로 가기의 대상 끝에 `--sync`를 붙입니다. |
| **MDNotePad+ Android** | [MDNotePad+-arm64.apk (1.16.3)](https://github.com/SeanKi/md-workspace/releases/download/v1.16.3/MDNotePad%2B-arm64.apk) | 64비트 Android 기기에 APK를 설치합니다. |

Android에 현재 공개된 APK는 **1.16.3**입니다. 아래에서 설명하는 **1.16.4~1.16.5의 새 기능은 Windows 1.16.5 기준**이며, Android APK에 모두 반영된 것은 아닙니다.

Windows는 **Windows 10/11 64비트와 WebView2 Runtime**이 필요합니다. Android APK는 **Android 7.0(API 24) 이상, arm64**용 시험 서명 빌드입니다.

Windows 동기화 모드 실행 예:

```bat
"C:\Apps\MDNotePad+\MDNotePad+.exe" --sync
```

바로 가기를 두 개 만들어 이름을 `MDNotePad+`, `MDNotePad+(동기화 모드)`로 정하면 편리합니다. 두 바로 가기는 같은 실행 파일을 가리키며, 동기화 모드 쪽에만 `--sync`를 붙입니다.

## MDNotePad+ — 문서 편집에 집중하는 모드

실행 파일을 그냥 열거나, 연결된 `.md` 문서를 열면 시작합니다. 저장소 목록과 동기화 패널 없이 **탭과 편집 화면**을 사용합니다. 창을 여러 개 띄워 서로 다른 문서를 편집할 수 있습니다.

- **위지윅·원본·변경점 비교**: 읽는 모습으로 편집하거나 마크다운 원문을 직접 고칩니다.
- **글자와 문단 꾸미기**: 제목, 굵게, 기울임, 밑줄, 취소선, 글자색·배경색, 목록, 체크 목록, 인용, 링크를 지원합니다.
- **표·코드·그림**: 표 편집, 코드블록 문법 강조, 이미지 삽입·붙여넣기, Mermaid 다이어그램을 지원합니다.
- **여러 문서와 본문 찾기**: 탭으로 문서를 오가고, **Ctrl+F** 또는 **🔍**로 현재 문서에서 찾습니다. 찾은 위치가 화면 안에 보이도록 이동합니다.
- **Windows 연동**: 설정의 **Windows 연결 → 등록**으로 탐색기 우클릭에 추가합니다. **기본 앱으로 정하기…**에서 `.md`를 여는 앱을 직접 선택할 수 있습니다.
- **PDF 저장**: 설정의 **지금 문서를 PDF로**로 현재 문서를 A4 PDF로 저장합니다. Windows 전용 기능입니다.

외부 편집기에서 파일이 바뀌면 변경을 감지합니다. 편집 중인 내용과 다르면 차이를 확인하고 불러올 내용이나 남길 내용을 고를 수 있습니다.

## MDNotePad+(동기화 모드) — 폴더와 여러 기기의 노트를 함께 관리

같은 실행 파일을 `--sync`로 실행하면 편집기에 **저장소 트리·전체 검색·자동 저장·Git 이력·WebDAV 동기화**가 더해집니다. 폴더를 여러 개 등록해 업무, 개인 메모, 프로젝트 문서를 나누어 관리할 수 있습니다.

| 기능 | 할 수 있는 일 |
|---|---|
| **저장소 트리** | 폴더를 펼쳐 문서를 열고, 새 노트·새 폴더 만들기, 이름 바꾸기, 옮기기, 삭제를 합니다. 로컬 삭제는 휴지통을 사용합니다. |
| **저장소 검색** | 등록한 저장소의 문서를 검색하고 결과를 눌러 해당 문서를 엽니다. |
| **자동 저장·Git 커밋** | 설정한 주기로 바뀐 문서를 저장하고, Git 저장소에서는 변경을 커밋으로 남길 수 있습니다. Git 기능에는 Git 설치가 필요합니다. |
| **WebDAV 연결** | 원격 저장소와 문서·이미지·첨부 파일을 맞추고 PC와 Android에서 이어서 사용합니다. WebDAV 서버나 계정이 필요합니다. |
| **필요한 문서만 받기** | 원격에서 가져올 때 목록부터 받고, 문서를 열면 해당 문서를 내려받습니다. |
| **변경 감지** | 앱이 실행 중일 때 저장소 폴더의 추가·삭제를 감지해 동기화합니다. |

동기화 모드는 한 창만 실행됩니다. 다시 실행하면 기존 동기화 창을 사용합니다. 단순 편집 모드 창은 별도로 열 수 있습니다.

### 처음 연결하는 순서

1. PC에서 **MDNotePad+(동기화 모드)**를 실행하고 문서 폴더를 저장소로 등록합니다.
2. 해당 저장소의 **원격 연결**에서 WebDAV 주소, 사용자, 비밀번호를 입력하고 연결을 확인합니다. 이미 원격에 있는 저장소를 받을 때는 **☁ 가져오기**를 사용합니다.
3. 다른 PC나 Android에서도 같은 원격 저장소를 연결합니다. 다른 기기에서 고친 내용은 동기화 후 이어서 편집할 수 있습니다.

WebDAV 동기화와 Git 커밋은 별개입니다. 기기 사이의 문서는 WebDAV로 맞추며, Git 커밋은 로컬 변경 이력을 남기는 기능입니다.

## 1.16.5에서 새로 할 수 있는 일

### 처음 만난 문서의 방향 고르기

같은 이름의 문서를 양쪽 기기가 따로 가지고 있고 함께 맞춘 기록이 없다면, 바로 덮어쓰지 않고 **방향 고르기**로 알려 줍니다. 문서마다 또는 한꺼번에 **내 것**, **원격 것**, **합치기**, **나중에**를 선택할 수 있습니다.

### 원격 문서 모두 받기와 새로고침

폴더나 저장소 뿌리를 오른쪽 클릭하고 **원격 문서 모두 받기**를 선택하면 문서를 한꺼번에 내려받습니다. 저장소 머리의 **↻**는 폴더 트리와 원격 목록을 다시 읽습니다.

### 화면 확대·축소

**Ctrl+마우스 휠**로 10%씩 확대·축소하고, **Ctrl+0**으로 100%로 돌아갑니다. 범위는 **75%~200%**이며 마지막 비율을 기기별로 기억합니다.

### 1.16.4부터 포함된 개선

- 동기화한 문서·첨부 파일을 로컬에서 지웠을 때 원격에 남거나 다시 받아지던 문제를 고쳤습니다.
- 저장소 폴더의 변경을 감지해 동기화합니다.
- Mermaid 그림 안의 글자를 선택할 수 있고, 본문 찾기의 결과도 그림 안에 표시합니다.

## Android — PC의 노트를 휴대폰에서 이어 쓰기

Android에서는 저장소와 원격 연결을 사용하는 **동기화 모드**로 시작합니다. Windows의 실행 옵션을 입력할 필요가 없습니다.

### PC의 연결 설정을 QR로 가져오기

1. PC의 동기화 모드에서 원격에 연결된 저장소 줄의 **QR** 단추를 누릅니다.
2. Android의 **원격 연결** 또는 **☁ 가져오기**에서 **📷 PC 화면의 QR 읽기**를 누릅니다.
3. 카메라로 PC 화면을 비추면 주소·사용자·비밀번호가 채워집니다. 연결할 저장소를 확인하고 진행합니다.

QR에는 연결 비밀번호가 들어 있으므로 읽은 뒤 닫고, 다른 사람에게 공유하지 마세요.

현재 공개 APK는 [1.16.3 릴리스](https://github.com/SeanKi/md-workspace/releases/tag/v1.16.3)의 `MDNotePad+-arm64.apk`입니다. 시험 서명 APK이므로 기기에서 해당 설치 경로의 **알 수 없는 앱 설치**를 허용해야 할 수 있습니다. Windows 전용인 PDF 저장과 탐색기 파일 연결 기능은 Android에 없습니다.

## 자주 쓰는 단축키 — Windows

| 단축키 | 동작 |
|---|---|
| **Ctrl+N** | 새 문서 |
| **Ctrl+O** | 문서 열기 |
| **Ctrl+S** | 저장 |
| **Ctrl+Shift+S** | 다른 이름으로 저장 |
| **Ctrl+W** | 현재 탭 닫기 |
| **Ctrl+Tab / Ctrl+Shift+Tab** | 다음 / 이전 탭 |
| **Ctrl+F** | 현재 문서에서 찾기 |
| **Enter / Shift+Enter** | 찾기 칸에서 다음 / 이전 결과 |
| **Ctrl+K** | 링크 넣기·고치기 |
| **Ctrl+마우스 휠 / Ctrl+0** | 확대·축소 / 100%로 되돌리기 |

## 설정과 문서 보관

Windows 설정과 최근 문서 목록은 실행 파일 옆의 **MDTiptap.ini**에 저장합니다. 원격 비밀번호는 Windows 자격 증명 저장소를 사용하므로, INI 파일만 복사하면 다른 PC에 비밀번호까지 옮겨지는 것은 아닙니다.

문서는 등록한 폴더의 실제 `.md` 파일입니다. 다른 편집기와 함께 사용할 수 있으며, 이미지는 문서에서 참조하는 파일로 보관합니다. 설정·기록을 별도 폴더에 두려면 `--home`을 사용합니다.

```bat
"C:\Apps\MDNotePad+\MDNotePad+.exe" --sync --home "C:\MyNotes\MDNotePadConfig"
```

## 직접 빌드하기

현재 제품 소스는 **tiptap-spike** 브랜치에서 개발합니다. 아래 명령은 **1.16.5 태그**를 기준으로 합니다. 준비물은 Node.js와 npm, Rust, Visual Studio C++ 빌드 도구입니다.

```bat
git clone https://github.com/SeanKi/md-workspace.git
cd md-workspace
git checkout v1.16.5
npm ci

npm run build -w md-tiptap
npm test -w @md/sync-core
cargo test --workspace --locked

cd apps\md-tiptap
..\..\node_modules\.bin\tauri.cmd build --no-bundle
```

결과 파일은 저장소 루트의 `target\release\md-tiptap.exe`입니다. 배포할 때 이름을 `MDNotePad+.exe`로 바꿉니다. Android 빌드에는 JDK, Android SDK/NDK와 Android용 Rust 타깃이 추가로 필요합니다.

## 개발 구조와 문서

현재 MDNotePad+의 편집기는 **Tiptap/ProseMirror**, 앱 실행 환경은 **Tauri v2**, 화면은 **React**, 다이어그램은 **Mermaid**를 사용합니다. 마크다운 읽기·쓰기는 별도의 공유 패키지로 구성합니다.

| 경로 | 역할 |
|---|---|
| `apps/md-tiptap` | 현재 MDNotePad+ 앱: 단순 모드·동기화 모드·Android |
| `packages/editor-tiptap` | 현재 위지윅 편집기 |
| `packages/md-bridge` | 마크다운 읽기·쓰기 |
| `packages/sync-core` | WebDAV 동기화 |
| `crates/md-core` | 파일 입출력·검색·변경 감지 등 공통 기능 |
| `apps/md-editor`, `apps/md-sync-note` | 이전 MD Notepad·MDSyncNote 앱 소스 |

이전 앱의 `MD-Notepad-portable.exe`, `MDSyncNote-portable.exe`는 과거 릴리스에서 받을 수 있습니다. **1.16.5 릴리스는 MDNotePad+.exe를 배포합니다.**

- [변경 이력](https://github.com/SeanKi/md-workspace/blob/tiptap-spike/docs/Update_History.md)
- [Windows 파일 연결 안내](https://github.com/SeanKi/md-workspace/blob/tiptap-spike/docs/Windows_File_Association.md)
- [빌드·릴리스 절차](https://github.com/SeanKi/md-workspace/blob/tiptap-spike/docs/Release.md)
- [개발 규약](https://github.com/SeanKi/md-workspace/blob/tiptap-spike/CLAUDE.md)

## 라이선스

[MIT](LICENSE) © 2026 SeanKi

사용한 오픈소스의 라이선스는 각 프로젝트의 라이선스를 따릅니다. Tiptap/ProseMirror, Mermaid, React, Tauri와 그 밖의 의존성에 감사드립니다.
