# MD Editor (Tauri) - Planned Features & Architecture

## 1. 방향

현재 MD Editor를 **Tauri 기반 데스크톱 애플리케이션**으로 확장한다.

기본 원칙은 다음과 같다.

-   실제 `.md` 파일을 유지하여 VS Code, Obsidian 등 외부 프로그램과
    호환한다.
-   로컬 폴더를 가장 기본적인 Repository(저장소)로 사용한다.
-   여러 Repository를 동시에 등록하고 좌측 Tree에서 탐색할 수 있도록
    한다.
-   SQLite는 Markdown 원본 저장소가 아니라 **인덱스, 검색, 변경 이력,
    동기화 상태 관리**에 사용한다.
-   향후 Server Repository를 추가할 수 있도록 Repository 접근 계층을
    추상화한다.
-   최종적으로 Notion 수준의 자연스러운 다중 기기 Offline-first 동기화를
    목표로 한다.
-   CRDT/Yjs는 초기부터 Markdown 파일을 대체하지 않고, 동기화 및 동시
    편집 계층으로 단계적으로 도입한다.

MD Editor V1
drag&drop으로 파일을 열 수 있고, tab을 이용해 여러개의 파을을 열고 전환할 수 있다.
현재 md 내용 창에서 복사한 이미지를 붙여넣기 하면, 현재 md 폴더 아래 images 라는 폴더가 생기며 그 아래 자동으로 이미지를 생성해서 저장하고 링크시켜서 사용 - 이 이미지 폴더는 차우 옵션을 수정하여 현재 폴더나 다른 서브폴더명으로 바꿀 수 있게 동적이 가능하도록 코딩

MDSyncNote - MD Editor를 이용해 향상된 기능을 제공하는 버전.
왼편에는 저장소를 추가할 수 있는 accordion tree view 오른 편은 선택한 Note를 볼 수 있는 내용 뷰 - MD Editor 내용뷰를 따름
accordion은 사용자의 폴더를 선택할 수 있게함. 차후 ftp와 webdav 지원 가능해야 함.
오른쪽에서 수정을 하면 특정 시간 후 자동 저장 현재는 1분(시간수정가능) - 변경사항이 있을때만 저장. 차후 변경에 대한 sqlite등의 기능을 넣돼 현재는 각 저장소별로, git local을 자동 추가 하고, 변경저장할 때 자동 commit,
폴더 구조를 보여주고, 새로운 폴더 생성, 이름변경, 삭제 가능하게 - 지정된 시간 후 자동 commit
폴더 아래에서 Note 추가, 이름변경, 이름삭제 가능하게 - 시간이 지나면 자동 commit
sync 기능은 accordion의 저장소를 - 저장소별로 또는 그룹별로 공유폴더나 ftp, webdav에 변경 사항이 있을 때 부분별 자동 전송 - 단방향 양방향 선택 - 차후 정의해서 작업 
------------------------------------------------------------------------

## 2. 전체 구조

``` text
MD Editor UI
   |
   +-- File Tree
   +-- Markdown Editor
   +-- Image Paste
   +-- Search
   |
   v
Tauri Backend
   |
   +-- Repository Manager
   |     +-- Local Folder
   |     +-- Server Repository (향후)
   |     +-- Other Providers
   |
   +-- File Watcher
   +-- Markdown File I/O
   +-- Image / Attachment Manager
   |
   +-- SQLite
         +-- Repository Metadata
         +-- File Index
         +-- FTS5
         +-- Revision Metadata
         +-- Sync Metadata
         +-- Offline Sync Queue
                |
                v
          Sync / Yjs Layer
                |
             WebSocket
                |
           Sync Server
```

------------------------------------------------------------------------

## 3. Repository / Workspace

### 3.1 Local Folder Repository

가장 기본적인 Repository는 실제 로컬 폴더 경로이다.

예:

``` text
Repository: My Notes
Path: C:\notes\quartz-content

+-- IT
|   +-- programming
|   |   +-- cpp.md
|   |   +-- tauri.md
|   +-- network.md
+-- English
|   +-- vocabulary.md
+-- diary.md
```

좌측 File Tree에서 실제 디렉터리 구조를 그대로 보여주며 파일을 클릭하면
해당 Markdown 문서를 연다.

### 3.2 Multiple Repositories

좌측 영역에 여러 저장소를 등록할 수 있도록 한다.

예:

``` text
Repositories

> Work
  C:\work\documents

> Personal
  C:\notes\quartz-content

> Project Notes
  D:\projects\notes

> Company Server
  Server Repository
```

초기 버전에서는 Local Folder Repository를 우선 구현한다.

### 3.3 Repository Provider

향후 서버 저장소 형식이 결정되지 않아도 확장할 수 있도록 Repository 접근
방식을 추상화한다.

개념적인 인터페이스:

``` typescript
interface RepositoryProvider {
    list(path: string): Promise<FileEntry[]>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    delete(path: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
}
```

향후 다음과 같은 Provider를 추가할 수 있다.

``` text
LocalFolderProvider
MdSyncServerProvider
WebDavProvider
GitProvider
```

서버 Repository의 구체적인 프로토콜이나 경로 표현 방식은 추후 결정한다.

------------------------------------------------------------------------

## 4. File Tree

좌측 패널에 Repository별 파일/폴더 Tree를 표시한다.

주요 기능:

-   Folder expand / collapse
-   Markdown 파일 클릭 시 Editor에서 열기
-   여러 Repository 표시
-   새 파일 생성
-   새 폴더 생성
-   Rename
-   Delete
-   Move
-   Drag & Drop
-   최근 열었던 파일
-   즐겨찾기
-   File Watcher를 통한 외부 변경 감지

실제 파일시스템이 Source of Truth가 되므로 VS Code 등 외부 프로그램에서
파일을 수정한 경우에도 변경을 감지해야 한다.

------------------------------------------------------------------------

## 5. Image Copy & Paste

Markdown Editor에서 Clipboard 이미지를 바로 붙여넣을 수 있도록 한다.

예:

1.  화면 캡처
2.  MD Editor에서 `Ctrl + V`
3.  이미지 파일 자동 생성
4.  Markdown 이미지 링크 자동 삽입

예:

``` markdown
![image](.attachments/20260829-015832-a12f.png)
```

### Attachment 저장 방식

Repository 공용 attachment 디렉터리를 우선 검토한다.

``` text
repository/
+-- docs/
+-- notes/
+-- .attachments/
    +-- 20260829-015832-a12f.png
    +-- 20260829-015912-31bf.png
```

문서별 attachment 폴더보다 Repository 공용 attachment 폴더를 사용하면
Markdown 문서를 이동하거나 이름을 변경할 때 이미지 경로 관리가
단순해진다.

추가 검토 기능:

-   Clipboard PNG/JPEG/WebP 처리
-   이미지 파일명 자동 생성
-   중복 이미지 hash 검사
-   사용되지 않는 attachment 검색
-   이미지 Drag & Drop
-   이미지 크기 조정
-   이미지 압축 옵션

------------------------------------------------------------------------

## 6. SQLite

Tauri 데스크톱 버전에서는 IndexedDB보다는 SQLite를 중심으로 로컬
메타데이터를 관리한다.

중요한 원칙:

> Markdown 파일 자체가 문서의 기본 portable format이며 SQLite는 검색,
> 인덱싱, 변경 관리 및 동기화를 지원한다.

예상 테이블:

### repositories

``` text
id
name
type
path
sync_type
sync_url
created_at
updated_at
```

### documents

``` text
id
repository_id
relative_path
title
content_hash
modified_at
indexed_at
```

### revisions

``` text
id
document_id
revision
hash
created_at
device_id
```

### sync_state

``` text
document_id
device_id
revision
sync_state
last_synced_at
```

### sync_queue

``` text
id
document_id
operation
base_revision
created_at
state
```

------------------------------------------------------------------------

## 7. Full Text Search (FTS)

SQLite FTS5를 이용하여 빠른 전문 검색을 제공한다.

검색 대상:

``` text
title
path
content
tags
```

목표:

-   파일명 검색
-   Markdown 본문 검색
-   제목 검색
-   Tag 검색
-   Repository 범위 검색
-   전체 Repository 통합 검색

수천\~수만 개 Markdown 문서에서도 빠르게 검색할 수 있도록 한다.

------------------------------------------------------------------------

## 8. File Watcher

실제 Markdown 파일을 Source of Truth로 유지하기 때문에 외부 프로그램에서
변경된 파일을 감지해야 한다.

``` text
VS Code
   |
   v
abc.md
   |
   v
File Watcher
   |
   +-- Re-index FTS
   +-- Update Hash
   +-- Update Revision
   +-- Notify Editor
   +-- Sync Check
```

고려할 항목:

-   현재 MD Editor가 저장해서 발생한 이벤트와 외부 프로그램 변경 이벤트
    구분
-   rename / move 감지
-   삭제 감지
-   대량 파일 변경 처리
-   Repository 전체 재검색 최소화
-   debounce 처리

------------------------------------------------------------------------

## 9. 변경 관리 / Revision History

각 Markdown 문서의 변경 상태를 추적한다.

기본적으로 다음 정보를 사용한다.

``` text
SHA-256 Content Hash
Revision
Device ID
Modified Time
```

향후 제공할 기능:

-   History
-   Compare
-   Restore
-   변경된 파일 표시
-   마지막 동기화 이후 변경 내용 확인

초기에는 CRDT 없이도 Revision History를 구현할 수 있도록 한다.

------------------------------------------------------------------------

## 10. Offline-first Storage & Synchronization

Desktop application is based on Tauri.

Actual Markdown files remain the primary portable document format.

SQLite is used for:

-   Repository metadata
-   File indexing
-   Full Text Search (FTS5)
-   Revision/history metadata
-   Synchronization metadata
-   Offline sync queue

Local Folder Repository를 우선 지원한다.

Repository 접근은 Repository Provider 계층을 통해 추상화하여 향후 Server
Repository를 추가할 수 있도록 한다.

동기화 기능은 한 번에 구현하지 않고 단계적으로 도입한다.

``` text
1. File Change Detection
2. Revision Tracking
3. Server-based Document Synchronization
4. Offline Change Queue
5. WebSocket Synchronization
6. Yjs / CRDT Multi-device Synchronization
```

최종 목표:

> 일반 Markdown 파일과의 호환성을 유지하면서 Notion과 유사한 매끄러운
> 다중 기기 Offline Editing 환경을 제공한다.

------------------------------------------------------------------------

## 11. Yjs / CRDT

초기 버전부터 다음 구조로 만드는 것은 피한다.

``` text
Markdown = Yjs Document
```

대신 Yjs를 Editing / Synchronization Layer로 사용한다.

``` text
Markdown File
     |
     v
Editor
     |
     v
Y.Doc
     |
     +-- Local Persistence
     |
     +-- WebSocket Sync
```

저장 시:

``` text
Y.Doc
  |
  v
Markdown Text
  |
  v
Atomic Write
  |
  v
xxx.md
```

이 구조를 사용하면 서버 연결이 없어도 일반적인 로컬 Markdown Editor로
동작할 수 있다.

서버 연결 시 Yjs/CRDT를 이용하여 여러 기기의 변경 내용을 병합할 수 있다.

### 외부 편집 문제

다음 상황을 반드시 고려해야 한다.

``` text
VS Code
   |
   v
abc.md
   |
   v
File Watcher
   |
   v
Y.Doc
```

VS Code 등의 외부 프로그램이 Markdown 파일 전체를 직접 변경하면 그
변경을 CRDT operation으로 어떻게 반영할지 결정해야 한다.

따라서 완전한 CRDT 기반 동기화는 초기 기능이 아니라 후기 단계에서
도입한다.

------------------------------------------------------------------------

## 12. 개발 단계

### Phase 1 - Desktop Markdown Workspace

우선 완성해야 할 핵심 기능:

``` text
Tauri
+ Local Folder Repository
+ Multiple Repositories
+ File Tree
+ Markdown Editor
+ Image Paste
+ File Watcher
+ SQLite Metadata
+ SQLite FTS5
```

이 단계만 완료해도 독립적인 Desktop Markdown Workspace로 사용할 수 있다.

### Phase 2 - Revision / Change Management

추가:

``` text
SHA-256 Content Hash
Revision
Device ID
Modified Time
History
Compare
Restore
```

### Phase 3 - Server Repository

Repository Provider 기반으로 서버 저장소를 추가한다.

``` text
RepositoryProvider
   |
   +-- LocalFolderProvider
   |
   +-- MdSyncServerProvider
```

필요한 기본 동작:

``` text
list
read
write
delete
move
```

### Phase 4 - Offline Sync

추가:

``` text
SQLite
+ Device ID
+ Revision
+ Offline Operation Queue
+ Sync State
+ WebSocket
```

오프라인 상태에서 변경한 내용은 SQLite `sync_queue`에 기록한다.

네트워크가 복구되면 서버와 변경 내용을 동기화한다.

### Phase 5 - Yjs / CRDT

다중 기기 편집에서 실제 conflict-free merge가 필요한 시점에 Yjs를
도입한다.

목표 사용자 경험:

``` text
PC A에서 문서 작성
        |
        v
     Server
        |
        v
노트북에서 거의 즉시 동일 내용 확인

        +

두 기기가 Offline 상태에서 수정
        |
        v
다시 Online
        |
        v
가능한 자연스럽게 변경 내용 병합
```

------------------------------------------------------------------------

## 13. 권장 구현 우선순위

현재 단계에서 가장 중요한 기반은 다음 네 가지이다.

``` text
1. Actual .md Files
2. Repository Provider
3. SQLite + FTS5
4. File Watcher
```

그 위에 다음 기능을 순차적으로 올린다.

``` text
Image Paste
     |
Revision History
     |
Server Repository
     |
Offline Sync Queue
     |
WebSocket Sync
     |
Yjs / CRDT
```

Yjs를 먼저 구현하기보다는 MD Editor 자체가 완성도 높은 Tauri Desktop
Markdown Workspace로 동작하도록 만드는 것을 우선한다.

------------------------------------------------------------------------

## 14. 최종 목표

MD Editor를 단순한 Markdown 편집기가 아니라 다음 특성을 갖는 Desktop
Knowledge Workspace로 확장한다.

-   실제 Markdown 파일 기반
-   여러 Local Repository 관리
-   File Tree
-   이미지 Copy & Paste
-   빠른 FTS 전문 검색
-   외부 Markdown Editor 호환
-   변경 이력 관리
-   Server Repository
-   Offline-first
-   Multi-device Sync
-   CRDT 기반 Conflict Resolution
-   향후 실시간 공동 편집 가능

궁극적으로는 **Markdown의 개방성과 파일 호환성을 유지하면서 Notion
수준의 자연스러운 검색, 변경 관리 및 다중 기기 동기화 경험을 제공하는
것**을 목표로 한다.
