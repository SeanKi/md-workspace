//! 명령줄로 넘어온 파일. 탐색기에서 "MD Editor로 열기" 를 누르면
//! Windows 가 `md-editor.exe "C:\...\note.md"` 형태로 실행한다.

use std::path::Path;

const EXTS: [&str; 4] = ["md", "markdown", "mdx", "txt"];

/// 시작 인자 중 실제로 존재하는 마크다운 파일 하나를 돌려준다.
/// 프론트엔드가 뜬 뒤 한 번 호출한다(부팅 시점에 창이 아직 없으므로).
#[tauri::command]
pub fn startup_file() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        let p = Path::new(a);
        p.is_file()
            && p.extension()
                .map(|e| EXTS.contains(&e.to_string_lossy().to_lowercase().as_str()))
                .unwrap_or(false)
    })
}

/// 창을 띄우지 않고 끝나는 명령. 설치·제거 스크립트에서 쓴다.
/// `md-editor.exe --register` / `--unregister`
pub fn early_exit_command() -> Option<&'static str> {
    for a in std::env::args().skip(1) {
        match a.as_str() {
            "--register" => return Some("register"),
            "--unregister" => return Some("unregister"),
            _ => {}
        }
    }
    None
}
