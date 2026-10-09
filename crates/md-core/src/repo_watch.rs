//! 저장소 폴더 감시 — 동기화(sync-core)가 쓴다.
//!
//! 앱이 떠 있는 동안 탐색기 · 다른 프로그램으로 문서나 그림을 **더하거나 지우면** 바로 알린다
//! (`repo-changed`). 앱은 몇 초 모아서 그 저장소를 맞추고, 사라진 것은 원격에서도 지운다
//! (engine.js — "로컬에서 사라진 것은 지운 것"). 앱이 꺼져 있을 때 바뀐 것은 다음에 뜰 때의
//! 맞추기가 같은 규칙으로 잡는다 — 감시는 그것을 **빨리** 하게 할 뿐이다.
//!
//! `watcher.rs`(열린 탭의 파일 하나)와 달리 저장소 전체를 하위 폴더까지 본다. 무엇이 바뀌었는지는
//! 동기화가 기록과 견주어 알아내므로 여기서는 "이 저장소에 뭔가 생겼다" 만 알린다.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct RepoChanged {
    pub root: String,
}

/// 동기화 기록 · git · 휴지통 등 — 우리가(또는 다른 도구가) 쓰는 자리라 알릴 것이 아니다
const SKIP: [&str; 8] = [".mdsync", ".git", ".mdtrash", ".trash", ".obsidian", "node_modules", ".mdlog", "~$"];

/// 같은 저장소의 알림은 이 간격 안에 하나만 — 폴더를 통째로 복사하면 이벤트가 수천 개 온다
const QUIET: Duration = Duration::from_millis(800);

struct Entry {
    _watcher: RecommendedWatcher,
}

fn repos() -> &'static Mutex<HashMap<String, Entry>> {
    static R: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// 알릴 만한 경로인가 — 저장소 안의 기록 폴더 · 임시 파일은 뺀다
fn worth(root: &str, path: &Path) -> bool {
    let p = norm(&path.to_string_lossy());
    let Some(rel) = p.strip_prefix(&norm(root)) else { return false };
    !rel.split('/').any(|seg| SKIP.iter().any(|s| seg == *s || (*s == "~$" && seg.starts_with("~$"))))
}

/// 저장소 하나를 감시한다. 이미 보고 있으면 아무 일도 하지 않는다
#[tauri::command(async)]
pub fn watch_repo(app: AppHandle, root: String) -> Result<(), String> {
    let k = norm(&root);
    let mut map = repos().lock().map_err(|e| e.to_string())?;
    if map.contains_key(&k) {
        return Ok(());
    }
    if !Path::new(&root).is_dir() {
        return Err(format!("폴더가 없습니다: {root}"));
    }
    let r = root.clone();
    let last = Mutex::new(Instant::now() - QUIET);
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !matches!(ev.kind, EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)) {
            return;
        }
        if !ev.paths.iter().any(|p| worth(&r, p)) {
            return;
        }
        let Ok(mut t) = last.lock() else { return };
        if t.elapsed() < QUIET {
            return;
        }
        *t = Instant::now();
        let _ = app.emit("repo-changed", RepoChanged { root: r.clone() });
    })
    .map_err(|e| e.to_string())?;
    w.watch(Path::new(&root), RecursiveMode::Recursive).map_err(|e| format!("{root} 를 감시하지 못했습니다: {e}"))?;
    map.insert(k, Entry { _watcher: w });
    Ok(())
}

/// 감시를 멈춘다 (저장소를 빼거나 원격을 끊었을 때)
#[tauri::command(async)]
pub fn unwatch_repo(root: String) -> Result<(), String> {
    repos().lock().map_err(|e| e.to_string())?.remove(&norm(&root));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 기록_폴더와_임시_파일은_알리지_않는다() {
        let root = r"C:\notes";
        assert!(worth(root, Path::new(r"C:\notes\a.md")));
        assert!(worth(root, Path::new(r"C:\notes\폴더\.image\p.png")));
        assert!(!worth(root, Path::new(r"C:\notes\.mdsync\repo.json")));
        assert!(!worth(root, Path::new(r"C:\notes\.git\index")));
        assert!(!worth(root, Path::new(r"C:\notes\.image\.mdtrash\p.png")));
        assert!(!worth(root, Path::new(r"C:\notes\~$보고서.docx")));
        assert!(!worth(root, Path::new(r"C:\other\a.md")));
    }
}
