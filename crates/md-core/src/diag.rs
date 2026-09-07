//! 화면이 멎은 상황을 기록한다.
//!
//! 왜 필요한가 — "가끔 얼어붙는다" 는 증상은 **일어난 그 자리에서만** 알 수 있다.
//! 나중에 재현하려 들면 못 잡는다. 그래서 앱이 스스로 적어 두게 한다.
//!
//! 어디에 — **실행 파일 옆 `.mdlog` 폴더**. 설정(`MDSyncNote.ini`)과 같은 자리라
//! 들고 다니기 쉽고, 폴더는 숨김으로 만들어 눈에 걸리지 않게 한다.
//! 날짜별로 한 파일씩 쌓고 오래된 것은 스스로 지운다 — 로그가 디스크를 먹으면 안 된다.

use std::io::Write;
use std::path::PathBuf;

const DIR: &str = ".mdlog";
/// 이보다 오래된 기록은 지운다
const KEEP_DAYS: u64 = 14;
/// 한 파일이 이보다 커지면 더 쓰지 않는다 (무한 반복에 로그가 폭주하는 것을 막는다)
const MAX_BYTES: u64 = 4 * 1024 * 1024;

fn dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("실행 파일 자리를 알 수 없습니다: {e}"))?;
    let d = exe
        .parent()
        .ok_or("실행 파일의 상위 폴더가 없습니다")?
        .join(DIR);
    if !d.exists() {
        std::fs::create_dir_all(&d).map_err(|e| format!("{} 를 만들지 못했습니다: {e}", d.display()))?;
        hide(&d);
    }
    Ok(d)
}

/// 윈도우에서 폴더를 숨김으로. 실패해도 로그는 계속 쌓여야 하므로 조용히 넘긴다.
#[cfg(windows)]
fn hide(path: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
    use windows::core::PCWSTR;

    let mut w: Vec<u16> = path.as_os_str().encode_wide().collect();
    w.push(0);
    unsafe {
        let _ = SetFileAttributesW(PCWSTR(w.as_ptr()), FILE_ATTRIBUTE_HIDDEN);
    }
}

#[cfg(not(windows))]
fn hide(_path: &std::path::Path) {}

/// `2026-09-07` — 날짜만 있으면 된다. 시각은 줄마다 프런트엔드가 적는다
fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

/// 유닉스 일수 → 연·월·일 (Howard Hinnant 의 civil_from_days).
/// 날짜 하나 때문에 크레이트를 더 넣을 이유가 없다.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 오래된 기록을 치운다. 한 번 실패해도 그냥 넘어간다
fn sweep(d: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(d) else { return };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(KEEP_DAYS * 86_400);
    for e in entries.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t < cutoff)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// 기록이 쌓이는 폴더. 화면에서 "여기를 보세요" 라고 말해 주려고 있다.
/// 처음 부를 때 폴더를 만들므로 이것도 스레드 풀로 보낸다.
#[tauri::command(async)]
pub fn log_dir() -> Result<String, String> {
    Ok(dir()?.to_string_lossy().to_string())
}

/// 줄들을 모아서 한 번에 붙인다. 한 줄마다 파일을 여닫으면 그게 또 느리다.
#[tauri::command(async)]
pub fn log_write(app: String, lines: Vec<String>) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let d = dir()?;
    sweep(&d);

    let file = d.join(format!("{app}-{}.log", today()));
    if std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        return Ok(());
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| format!("{} 를 열지 못했습니다: {e}", file.display()))?;
    for line in lines {
        writeln!(f, "{}", line.replace(['\r', '\n'], " ")).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 마지막 몇 줄. 설정 화면에서 바로 보여 주려고 있다.
#[tauri::command(async)]
pub fn log_tail(app: String, count: usize) -> Result<Vec<String>, String> {
    let file = dir()?.join(format!("{app}-{}.log", today()));
    let Ok(text) = std::fs::read_to_string(&file) else { return Ok(vec![]) };
    let all: Vec<&str> = text.lines().collect();
    Ok(all[all.len().saturating_sub(count)..]
        .iter()
        .map(|s| s.to_string())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 날짜_셈이_맞는다() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1), "윤년 경계");
        assert_eq!(civil_from_days(20_338), (2025, 9, 7));
    }

    #[test]
    fn 오늘_이름은_날짜_모양이다() {
        let t = today();
        assert_eq!(t.len(), 10);
        assert!(t.chars().filter(|c| *c == '-').count() == 2, "{t}");
    }
}
