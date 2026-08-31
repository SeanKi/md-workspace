//! 파일 감시. 외부 편집기(VS Code 등)가 파일을 바꾸면 프론트엔드에 알린다.
//!
//! 두 가지가 이 모듈의 전부다.
//!
//! **폴더를 감시한다.** 많은 편집기가 "임시 파일에 쓰고 이름 바꾸기" 로 저장하기
//! 때문에, 파일 자체를 감시하면 원본이 지워졌다 새로 생기는 것으로 보여 감시가
//! 끊긴다. 상위 폴더를 감시하고 파일 이름으로 걸러낸다.
//!
//! **내용 해시로 판단한다.** 시간이나 이벤트 종류로 "우리가 저장한 것"과 "밖에서
//! 바뀐 것"을 가르려 하면 반드시 틀린다. 대신 마지막으로 우리가 아는 내용의 해시를
//! 들고 있다가, 이벤트가 오면 파일을 다시 읽어 비교한다. 같으면 알리지 않는다.
//! 저장 직후 돌아오는 자기 이벤트도, 편집기가 같은 내용을 다시 쓴 경우도 걸러진다.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct FileChanged {
    pub path: String,
}

#[derive(Default)]
struct Watched {
    watcher: Option<RecommendedWatcher>,
    /// 감시 중인 파일 → 마지막으로 우리가 아는 내용 해시
    files: HashMap<String, u64>,
    /// 감시 중인 폴더 → 그 안에서 보고 있는 파일 수
    dirs: HashMap<String, usize>,
    /// 정규화한 키 → 프론트엔드가 준 원래 경로
    original: HashMap<String, String>,
}

fn state() -> &'static Mutex<Watched> {
    static S: OnceLock<Mutex<Watched>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Windows 는 대소문자를 가리지 않고 구분자도 섞여 온다. 비교용 키로 맞춘다.
fn key(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

fn hash_bytes(b: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    b.hash(&mut h);
    h.finish()
}

/// 우리가 쓴 내용을 기록해 둔다. 자기 저장이 변경 알림으로 돌아오는 것을 막는다.
pub fn remember(path: &str, bytes: &[u8]) {
    if let Ok(mut st) = state().lock() {
        let k = key(path);
        if st.files.contains_key(&k) {
            st.files.insert(k, hash_bytes(bytes));
        }
    }
}

/// 감시 중인 파일이 실제로 바뀌었는지 본다. 바뀌었으면 기록을 갱신하고 true.
/// 지워졌거나 읽을 수 없으면 알리지 않는다 (편집기가 저장하는 중일 수 있다).
fn changed(st: &mut Watched, k: &str) -> bool {
    let Some(known) = st.files.get(k).copied() else {
        return false;
    };
    let Some(orig) = st.original.get(k).cloned() else {
        return false;
    };
    let Ok(bytes) = std::fs::read(&orig) else {
        return false;
    };
    let now = hash_bytes(&bytes);
    if now == known {
        return false;
    }
    st.files.insert(k.to_string(), now);
    true
}

#[tauri::command]
pub fn watch_file(app: AppHandle, path: String) -> Result<(), String> {
    let dir = Path::new(&path)
        .parent()
        .ok_or("상위 폴더를 찾을 수 없습니다")?
        .to_path_buf();

    let mut st = state().lock().map_err(|e| e.to_string())?;

    if st.watcher.is_none() {
        let handle = app.clone();
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if !matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                return;
            }
            let Ok(mut st) = state().lock() else { return };
            for p in &ev.paths {
                let k = key(&p.to_string_lossy());
                if changed(&mut st, &k) {
                    if let Some(orig) = st.original.get(&k).cloned() {
                        let _ = handle.emit("file-changed", FileChanged { path: orig });
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
        st.watcher = Some(w);
    }

    let k = key(&path);
    if st.files.contains_key(&k) {
        return Ok(());
    }
    let hash = std::fs::read(&path).map(|b| hash_bytes(&b)).unwrap_or(0);
    st.files.insert(k.clone(), hash);
    st.original.insert(k, path.clone());

    let dk = key(&dir.to_string_lossy());
    let first = {
        let n = st.dirs.entry(dk).or_insert(0);
        *n += 1;
        *n == 1
    };
    if first {
        if let Some(w) = st.watcher.as_mut() {
            w.watch(&dir, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(path: String) -> Result<(), String> {
    let mut st = state().lock().map_err(|e| e.to_string())?;
    let k = key(&path);
    if st.files.remove(&k).is_none() {
        return Ok(());
    }
    st.original.remove(&k);

    let Some(dir) = Path::new(&path).parent().map(|p| p.to_path_buf()) else {
        return Ok(());
    };
    let dk = key(&dir.to_string_lossy());
    let empty = match st.dirs.get_mut(&dk) {
        Some(n) => {
            *n -= 1;
            *n == 0
        }
        None => false,
    };
    if empty {
        st.dirs.remove(&dk);
        if let Some(w) = st.watcher.as_mut() {
            let _ = w.unwatch(&dir);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> String {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("mdwatch-{tag}-{n}.md"))
            .to_string_lossy()
            .to_string()
    }

    fn watched_with(path: &str, bytes: &[u8]) -> Watched {
        std::fs::write(path, bytes).unwrap();
        let mut st = Watched::default();
        let k = key(path);
        st.files.insert(k.clone(), hash_bytes(bytes));
        st.original.insert(k, path.to_string());
        st
    }

    #[test]
    fn 내용이_같으면_알리지_않는다() {
        let p = tmp("same");
        let mut st = watched_with(&p, b"# hello");
        // 이벤트만 오고 내용은 그대로인 경우 — 우리가 저장했을 때가 이렇다
        assert!(!changed(&mut st, &key(&p)));
        std::fs::write(&p, b"# hello").unwrap();
        assert!(!changed(&mut st, &key(&p)));
    }

    #[test]
    fn 내용이_바뀌면_한_번만_알린다() {
        let p = tmp("diff");
        let mut st = watched_with(&p, b"# hello");
        std::fs::write(&p, b"# hello world").unwrap();
        assert!(changed(&mut st, &key(&p)), "바뀌었으면 알린다");
        assert!(!changed(&mut st, &key(&p)), "같은 변경으로 두 번 알리지 않는다");
    }

    #[test]
    fn 감시하지_않거나_지워진_파일은_알리지_않는다() {
        let p = tmp("gone");
        let mut st = watched_with(&p, b"x");
        assert!(!changed(&mut st, "감시하지/않는/경로"));
        std::fs::remove_file(&p).unwrap();
        assert!(!changed(&mut st, &key(&p)), "지워진 파일은 알리지 않는다");
    }

    /// notify 배선 자체를 확인한다 — 파일이 아니라 **폴더**를 감시해도
    /// 그 안의 파일 저장이 잡히는가. 이 전제가 깨지면 감시가 조용히 죽는다.
    #[test]
    fn 폴더를_감시하면_그_안의_파일_저장이_잡힌다() {
        use std::sync::mpsc;
        use std::time::Duration;

        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mdwatch-dir-{n}"));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, b"first").unwrap();

        let (tx, rx) = mpsc::channel();
        let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    let _ = tx.send(ev.paths);
                }
            }
        })
        .unwrap();
        w.watch(&dir, RecursiveMode::NonRecursive).unwrap();

        // 감시가 자리 잡을 시간을 조금 준다
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(&file, b"second").unwrap();

        let mut seen = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(paths) => {
                    if paths.iter().any(|p| key(&p.to_string_lossy()) == key(&file.to_string_lossy())) {
                        seen = true;
                        break;
                    }
                }
                Err(_) => {}
            }
        }
        let _ = w.unwatch(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(seen, "폴더 감시로 파일 저장 이벤트를 받지 못했다");
    }

    #[test]
    fn 우리가_쓴_내용은_알리지_않는다() {
        let p = tmp("remember");
        std::fs::write(&p, b"first").unwrap();
        {
            let mut g = state().lock().unwrap();
            let k = key(&p);
            g.files.insert(k.clone(), hash_bytes(b"first"));
            g.original.insert(k, p.clone());
        }
        std::fs::write(&p, b"second").unwrap();
        remember(&p, b"second");
        let mut g = state().lock().unwrap();
        assert!(!changed(&mut g, &key(&p)), "우리가 쓴 것은 알리지 않는다");
    }
}
