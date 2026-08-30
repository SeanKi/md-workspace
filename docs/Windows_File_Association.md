# Windows 파일 연결 검토 (.md 우클릭 · 연결 프로그램)

기준 2026-08-30 · MD Editor v0.4.0 · 구현 위치 `apps/md-editor/src-tauri/src/win_assoc.rs`

탐색기에서 `.md` 를 더블클릭하거나 우클릭했을 때 MD Editor 로 열리게 하는 방법을
정리한다. **결론부터: 우클릭 메뉴와 "연결 프로그램" 목록까지는 프로그램이 넣을 수
있고, 기본 앱 지정은 사용자가 직접 눌러야 한다.**

---

## 1. 할 수 있는 것과 없는 것

| 하고 싶은 것 | 가능한가 | 방법 |
|---|:---:|---|
| `.md` 우클릭 → "MD Editor로 열기" | O | `SystemFileAssociations\.md\shell\<verb>` |
| 우클릭 → 연결 프로그램 목록에 MD Editor | O | `.md\OpenWithProgids` + `Applications\<exe>` |
| 앱 안에서 등록/해제 버튼 | O | 설정(⚙) → Windows 연결 |
| 설치·제거 스크립트에서 자동 등록 | O | `md-editor.exe --register` / `--unregister` |
| **더블클릭 기본 앱을 프로그램이 바꾸기** | **X** | Win10+ 정책. 아래 3절 |

### 왜 기본 앱은 못 바꾸나

Windows 8 부터 기본 앱 선택은 `HKCU\...\FileExts\.md\UserChoice` 에 저장되는데,
여기에는 사용자 SID·확장자·ProgId·시각을 섞어 만든 **비공개 해시**가 함께 들어간다.
해시가 맞지 않으면 Windows 가 그 값을 무시하고 지운다. 해시 생성 알고리즘은 공개돼
있지 않고, 흉내 내는 것은 정책 위반이며 업데이트마다 깨진다.

그래서 정상적인 앱이 할 수 있는 것은 **후보로 등록하고 사용자를 안내하는 것**뿐이다.
`.md` 우클릭 → 연결 프로그램 → 다른 앱 선택 → MD Editor → "항상 이 앱으로 열기".

---

## 2. 실제로 만드는 레지스트리 키

모두 `HKEY_CURRENT_USER\Software\Classes` 아래다. **관리자 권한이 필요 없고**,
다른 사용자 계정과 시스템 설정을 건드리지 않는다. `<exe>` 는 실행 중인 실행 파일의
전체 경로.

```
MDEditor.md\                       (기본값) = "Markdown 문서"
MDEditor.md\DefaultIcon            (기본값) = "<exe>",0
MDEditor.md\shell\open\command     (기본값) = "<exe>" "%1"

Applications\md-editor.exe         FriendlyAppName = "MD Editor"
Applications\md-editor.exe\shell\open\command  (기본값) = "<exe>" "%1"
Applications\md-editor.exe\SupportedTypes      .md / .markdown / .mdx

.md\OpenWithProgids                MDEditor.md = ""     ← 기존 값을 지우지 않고 추가만
.markdown\OpenWithProgids          MDEditor.md = ""
.mdx\OpenWithProgids               MDEditor.md = ""

SystemFileAssociations\.md\shell\MDEditor.Open           (기본값) = "MD Editor로 열기"
SystemFileAssociations\.md\shell\MDEditor.Open           Icon = "<exe>",0
SystemFileAssociations\.md\shell\MDEditor.Open\command   (기본값) = "<exe>" "%1"
   (.markdown, .mdx 도 동일)
```

설계상 지킨 것 두 가지.

- **`.md` 의 (기본값)을 건드리지 않는다.** 그 값을 바꾸면 다른 앱의 연결을 빼앗는
  꼴이 된다. 후보 목록인 `OpenWithProgids` 에 값 하나를 더할 뿐이다.
- **우클릭 메뉴는 `SystemFileAssociations` 에 넣는다.** ProgId 쪽이 아니라 확장자
  자체에 붙으므로, 기본 앱이 VS Code 든 메모장이든 상관없이 항상 보인다.

등록·해제 후 `SHChangeNotify(SHCNE_ASSOCCHANGED)` 를 호출해 탐색기가 즉시 반영하게
한다. 이게 없으면 재로그인해야 메뉴가 보인다.

---

## 3. 쓰는 방법

### 앱에서

설정(⚙) → **Windows 연결** → [등록] / [해제].
현재 실행 중인 exe 로 등록되며, 다른 빌드로 등록돼 있으면 "다시 등록" 을 안내한다.

### 명령줄 (설치/제거 스크립트용)

```bat
md-editor.exe --register      :: 창을 띄우지 않고 등록만 하고 종료
md-editor.exe --unregister
```

### 확인

```bat
reg query "HKCU\Software\Classes\MDEditor.md" /s
reg query "HKCU\Software\Classes\.md\OpenWithProgids"
reg query "HKCU\Software\Classes\SystemFileAssociations\.md" /s
```

---

## 4. 설치 프로그램(NSIS)과 묶는 법

`tauri.conf.json` 의 번들 타겟이 `nsis` 다. Tauri v2 는 설치 스크립트에 끼워 넣을
훅 파일을 지원한다.

```json
"bundle": { "windows": { "nsis": { "installerHooks": "installer.nsh" } } }
```

```nsis
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\MD Editor.exe" --register'
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\MD Editor.exe" --unregister'
!macroend
```

지금은 **넣지 않았다.** 설치 시 자동 등록은 사용자가 고르지 않은 변경이고,
앱 안의 버튼으로 충분하다. 필요해지면 위 다섯 줄이 전부다.

---

## 5. 제약과 남은 것

| 제약 | 내용 | 대응 |
|---|---|---|
| 기본 앱 강제 불가 | 2절 참고 | 안내 문구로 대신 |
| 개발 빌드 경로가 등록됨 | `target\debug\md-editor.exe` 로 등록된 뒤 그 파일을 지우면 메뉴가 깨진다 | 상태 표시가 "다른 빌드로 등록됨"을 알려준다. 배포본에서 다시 등록 |
| **파일마다 새 창** | 탐색기에서 두 파일을 열면 프로세스가 둘 뜬다. 탭으로 합쳐지지 않는다 | `tauri-plugin-single-instance` 로 기존 창에 경로를 넘기면 해결. 다음 작업 후보 |
| 아이콘 | ProgId 아이콘이 exe 아이콘이라 `.md` 파일 아이콘이 MD Editor 아이콘으로 바뀔 수 있다(기본 앱으로 지정한 경우) | 전용 문서 아이콘을 만들면 `DefaultIcon` 만 바꾸면 된다 |
| Windows 전용 | 다른 OS 에서는 `supported: false` 로 UI 자체가 숨는다 | — |

---

## 6. 명령줄로 받은 파일을 여는 경로

연결이 동작하려면 앱이 `argv[1]` 을 처리해야 한다.

```
탐색기 우클릭 → "MD Editor로 열기"
  → md-editor.exe "C:\notes\a.md"
    → cli::startup_file()      (Rust, 존재하는 마크다운 파일인지 확인)
      → App.jsx 가 마운트 후 한 번 invoke
        → 빈 탭 하나뿐이면 그 자리를, 아니면 새 탭을 만들어 연다
```

부팅 시점에는 창이 아직 없으므로 Rust 가 먼저 열어 주는 방식이 아니라
**프론트엔드가 떠서 물어보는** 방식으로 했다. 창이 준비된 뒤 열리므로
초기화 순서 문제가 없다.
