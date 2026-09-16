//! 탭을 **다른 창으로** 옮긴다 (크롬에서 탭을 끌어 다른 창에 놓는 것).
//!
//! 창 하나가 프로세스 하나다. 그래서 "이 탭을 저 창으로" 는 창 안의 일이 아니라
//! **프로세스 사이의 일**이고, 둘을 잇는 길이 따로 있어야 한다.
//!
//! 길은 **임시 폴더의 우편함 파일** 하나다. 라이브러리를 더하지 않고, 파이프나
//! 창 메시지처럼 손이 많이 가지도 않는다.
//!
//!   1. 놓은 자리의 창을 찾는다 — `WindowFromPoint` 로 그 창의 프로세스 번호를 얻는다
//!   2. 그 번호로 된 `<pid>.live` 가 있으면 우리 앱이다. `<pid>.open` 에 경로를 쓴다
//!   3. 받는 쪽은 자기 우편함을 들여다보다가, 있으면 **읽고 지운다**
//!   4. **지워졌다는 것이 "받았다" 는 신호다.** 그때에만 보낸 쪽이 탭을 닫는다
//!
//! 답장을 따로 주고받지 않는 이유가 4번이다. 상대가 죽었거나 남의 프로세스였으면
//! 파일이 그대로 남고, 우리는 2초 뒤 포기하고 **새 창으로 연다**. 탭이 사라지는
//! 일은 생기지 않는다.
//!
//! 우편함을 알림(notify)이 아니라 들여다보기로 한 것은 일부러다 — 300ms 마다
//! 파일 하나가 있는지 보는 일이라 값이 없고, 감시자의 수명·이벤트 종류를
//! 신경 쓸 일도 없다. 끌어다 놓는 손짓보다 훨씬 빠르다.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

/// 우편함을 들여다보는 간격
const POLL_MS: u64 = 300;
/// 상대가 받아 갈 때까지 기다리는 시간. 넘으면 새 창으로 연다
const WAIT_MS: u64 = 2000;
/// 이보다 오래된 찌꺼기는 지운다 (죽은 프로세스가 남긴 것)
const STALE_SECS: u64 = 60 * 60 * 24;

#[derive(Clone, Serialize)]
pub struct Handoff {
    pub path: String,
}

fn dir() -> PathBuf {
    std::env::temp_dir().join("md-notepad-tabs")
}

fn me() -> u32 {
    std::process::id()
}

/// 받을 편지가 놓이는 자리
fn mailbox(pid: u32) -> PathBuf {
    dir().join(format!("{pid}.open"))
}

/// "이 번호는 살아 있는 MD Notepad 다" 는 표시
fn live(pid: u32) -> PathBuf {
    dir().join(format!("{pid}.live"))
}

/// 죽은 프로세스가 남긴 찌꺼기를 걷어낸다. 남아 있어도 2초 기다렸다 새 창으로
/// 넘어가므로 치명적이지는 않지만, 그 2초가 아깝다.
fn sweep(d: &Path) {
    let Ok(entries) = std::fs::read_dir(d) else { return };
    for e in entries.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| SystemTime::now().duration_since(t).unwrap_or_default().as_secs() > STALE_SECS)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// 우편함을 연다. 앱이 뜰 때 한 번 부른다.
pub fn start(app: AppHandle) {
    let d = dir();
    if std::fs::create_dir_all(&d).is_err() {
        return;
    }
    sweep(&d);
    let _ = std::fs::write(live(me()), me().to_string());

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(POLL_MS));
        let letter = mailbox(me());
        let Ok(text) = std::fs::read_to_string(&letter) else { continue };
        // 지우는 것이 "받았다" 는 신호다. 열기보다 **먼저** 지운다 —
        // 보낸 쪽은 이 순간을 기다리고 있고, 여는 데 실패해도 탭이 둘이 되면 안 된다
        let _ = std::fs::remove_file(&letter);
        let path = text.trim().to_string();
        if path.is_empty() {
            continue;
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        let _ = app.emit("tab-handoff", Handoff { path });
    });
}

/// 창이 닫힐 때 자기 표시를 거둔다.
pub fn cleanup() {
    let _ = std::fs::remove_file(live(me()));
    let _ = std::fs::remove_file(mailbox(me()));
}

/// 우편함에 넣고 받아 갈 때까지 기다린다. 받아 갔으면 true.
fn deliver(pid: u32, path: &str) -> Result<bool, String> {
    let letter = mailbox(pid);

    // 앞의 편지가 아직 있으면 잠깐 기다린다. 덮어쓰면 그 탭이 통째로 사라진다
    let until = Instant::now() + Duration::from_millis(WAIT_MS);
    while letter.exists() && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(50));
    }

    // 쓰다 만 것을 상대가 읽지 않도록 다른 이름으로 썼다가 옮긴다
    let tmp = dir().join(format!("{pid}-{}.tmp", me()));
    std::fs::write(&tmp, path).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &letter).map_err(|e| e.to_string())?;

    let until = Instant::now() + Duration::from_millis(WAIT_MS);
    while Instant::now() < until {
        if !letter.exists() {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // 아무도 받지 않았다 — 남의 프로세스였거나 죽었다. 치우고 돌아간다
    let _ = std::fs::remove_file(&letter);
    Ok(false)
}

fn spawn_new(path: &str) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // 새로 뜬 창이 인자에서 파일을 찾아 연다 (`cli::startup_file`)
    std::process::Command::new(exe)
        .arg(path)
        .spawn()
        .map_err(|e| format!("새 창을 띄우지 못했습니다: {e}"))?;
    Ok("new-window".into())
}

/// 탭을 마우스가 놓인 자리의 창으로 넘긴다.
///
/// 좌표를 프론트엔드에서 받지 않고 **여기서 직접 읽는다**(`GetCursorPos`).
/// 화면 좌표를 CSS 픽셀에서 물리 픽셀로 되돌리는 셈은 모니터마다 배율이 다르면
/// 틀리는데, 손을 뗀 그 순간 커서는 여전히 그 자리에 있다.
///
/// @returns `self`(제 창 위) · `moved`(다른 창으로 옮김) · `new-window`(새 창)
#[tauri::command(async)]
pub fn hand_off_tab(path: String) -> Result<String, String> {
    if !Path::new(&path).is_file() {
        return Err(format!("파일이 없습니다: {path}"));
    }
    let Some((hwnd, pid)) = sys::window_under_cursor() else {
        return spawn_new(&path);
    };
    if pid == me() {
        return Ok("self".into());
    }
    if live(pid).exists() {
        // 받는 쪽이 스스로 앞에 나설 수 있게 허락해 둔다 (Windows 의 포그라운드 규칙)
        sys::allow_foreground(pid);
        if deliver(pid, &path)? {
            sys::to_front(hwnd);
            return Ok("moved".into());
        }
    }
    spawn_new(&path)
}

/* ---------- 놓은 자리의 창 찾기 ---------- */

#[cfg(windows)]
mod sys {
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: i32,
        y: i32,
    }

    const GA_ROOT: u32 = 2;
    const SW_RESTORE: i32 = 9;

    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(p: *mut Point) -> i32;
        fn WindowFromPoint(p: Point) -> isize;
        fn GetAncestor(hwnd: isize, flags: u32) -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn SetForegroundWindow(hwnd: isize) -> i32;
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
        fn IsIconic(hwnd: isize) -> i32;
        fn AllowSetForegroundWindow(pid: u32) -> i32;
    }

    /// 커서 아래 창의 (맨 바깥 창 손잡이, 프로세스 번호).
    /// `WindowFromPoint` 는 자식 컨트롤을 주므로 **맨 바깥까지 올라가야** 한다 —
    /// 그러지 않으면 WebView2 의 자식 창이 잡혀 프로세스 번호가 엉뚱하게 나온다.
    pub fn window_under_cursor() -> Option<(isize, u32)> {
        let mut p = Point { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut p) } == 0 {
            return None;
        }
        let hit = unsafe { WindowFromPoint(p) };
        if hit == 0 {
            return None;
        }
        let root = unsafe { GetAncestor(hit, GA_ROOT) };
        let root = if root == 0 { hit } else { root };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(root, &mut pid) };
        (pid != 0).then_some((root, pid))
    }

    pub fn allow_foreground(pid: u32) {
        unsafe { AllowSetForegroundWindow(pid) };
    }

    pub fn to_front(hwnd: isize) {
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(not(windows))]
mod sys {
    pub fn window_under_cursor() -> Option<(isize, u32)> {
        None
    }
    pub fn allow_foreground(_pid: u32) {}
    pub fn to_front(_hwnd: isize) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 우편함의 약속 — **지워지는 것이 받았다는 신호다.**
    /// 이 약속이 깨지면 받지도 않은 탭을 보낸 쪽이 닫아 버린다.
    #[test]
    fn 받아_가면_true_아무도_안_받으면_false() {
        std::fs::create_dir_all(dir()).unwrap();
        let pid = 999_000 + (me() % 1000);
        let letter = mailbox(pid);
        let _ = std::fs::remove_file(&letter);

        // 받는 쪽 흉내 — 잠깐 뒤에 읽고 지운다
        let l = letter.clone();
        std::thread::spawn(move || {
            for _ in 0..40 {
                if l.exists() {
                    let got = std::fs::read_to_string(&l).unwrap();
                    assert_eq!(got, "C:/노트/a.md");
                    std::fs::remove_file(&l).unwrap();
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        });
        assert!(deliver(pid, "C:/노트/a.md").unwrap(), "받아 갔으면 true");

        // 아무도 없으면 기다리다 포기하고, 남긴 것도 치운다
        assert!(!deliver(pid, "C:/노트/b.md").unwrap(), "아무도 안 받으면 false");
        assert!(!letter.exists(), "포기한 편지는 치운다");
    }

    #[test]
    fn 없는_파일은_넘기지_않는다() {
        let e = hand_off_tab("C:/이런/파일은/없다.md".into()).unwrap_err();
        assert!(e.contains("파일이 없습니다"));
    }
}
