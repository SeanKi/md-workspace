//! 트리 우클릭에서 바깥으로 여는 것 두 가지.
//!
//!   - **문서 → MDNotePad+ 단순 모드** — 이 실행 파일을 `--sync` 없이 한 번 더 띄운다. 단순 모드는
//!     창마다 따로 뜨므로(lib.rs) 새 창이 하나 뜬다. 예전에는 옛 앱(MD Notepad)을 찾아 넘겼다
//!   - **폴더 → 탐색기**

use std::path::PathBuf;
use std::process::Command;

/// 문서를 단순 모드 새 창으로. 이 창이 `--home` 으로 떴으면 같은 설정 폴더를 쓰게 넘긴다
#[tauri::command(async)]
pub fn open_simple(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(format!("파일이 없습니다: {path}"));
    }
    let exe = std::env::current_exe().map_err(|e| format!("실행 파일 자리를 알 수 없습니다: {e}"))?;
    let mut cmd = Command::new(&exe);
    if let Some(home) = crate::cli::home_dir() {
        cmd.arg("--home").arg(home);
    }
    cmd.arg(&file)
        .spawn()
        .map_err(|e| format!("{} 를 실행하지 못했습니다: {e}", exe.display()))?;
    Ok(())
}

/// 폴더를 탐색기로 연다
#[tauri::command(async)]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("폴더가 없습니다: {path}"));
    }
    #[cfg(windows)]
    {
        // explorer 는 `/` 경로를 못 알아듣는다
        let p = path.replace('/', "\\");
        Command::new("explorer").arg(p).spawn().map_err(|e| format!("탐색기를 열지 못했습니다: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("이 기기에서는 탐색기로 열 수 없습니다".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 없는_파일과_폴더는_거절한다() {
        assert!(open_simple("C:/없는/파일.md".into()).is_err());
        assert!(open_in_explorer("C:/없는/폴더".into()).is_err());
    }
}
