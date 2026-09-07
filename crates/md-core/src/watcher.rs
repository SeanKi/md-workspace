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
    /// 우리가 곧 쓸(또는 방금 쓴) 내용의 해시. 자기 저장을 걸러내는 데 쓴다
    expected: HashMap<String, Vec<u64>>,
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

/// **파일을 쓰기 전에** 부른다. "이 내용은 우리가 쓴 것"이라고 미리 등록해 둔다.
///
/// 쓰고 나서 알리면 늦다. 감시 스레드는 이미 디렉터리 핸들에 붙어 깨어 있어서,
/// 우리 스레드가 write 에서 돌아와 자물쇠를 잡기 전에 먼저 파일을 읽고
/// "밖에서 바뀌었다"고 판정해 버린다. 저장할 때마다 알림이 뜨던 원인이 이것이다.
pub fn expect_write(path: &str, bytes: &[u8]) {
    if let Ok(mut st) = state().lock() {
        note_expected(&mut st, path, bytes);
    }
}

fn note_expected(st: &mut Watched, path: &str, bytes: &[u8]) {
    let k = key(path);
    if !st.files.contains_key(&k) {
        return; // 감시 중이 아니면 알 필요가 없다
    }
    let list = st.expected.entry(k).or_default();
    list.push(hash_bytes(bytes));
    if list.len() > 4 {
        list.remove(0); // 연달아 저장해도 목록이 늘어나지 않게
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
    // 우리가 쓴다고 미리 알려 둔 내용이면 외부 변경이 아니다
    if let Some(list) = st.expected.get_mut(k) {
        if let Some(i) = list.iter().position(|h| *h == now) {
            list.remove(i);
            st.files.insert(k.to_string(), now);
            return false;
        }
    }
    st.files.insert(k.to_string(), now);
    true
}

// 이 둘은 **빠를 것 같지만 빠르지 않다.** 실제 기록에 남은 것 —
//
//     멎음  17716ms · 직전 호출 watch_file (17.3초 전)
//     느림  watch_file 17437ms — ...\docs.CounterSpec_X-Ray_Ver2.4.2.md
//
// 파일을 통째로 읽어 해시하고(`fs::read`), 폴더에 감시를 건다. 네트워크·동기화 폴더면
// 둘 다 몇 초씩 걸린다. 메인 스레드에 두면 그동안 창이 통째로 멎는다.
#[tauri::command(async)]
pub fn watch_file(app: AppHandle, path: String) -> Result<(), String> {
    let dir = Path::new(&path)
        .parent()
        .ok_or("상위 폴더를 찾을 수 없습니다")?
        .to_path_buf();

    // 파일 읽기는 자물쇠 **밖에서**. 느린 일을 붙잡고 있으면 다른 감시도 함께 막힌다
    let hash = std::fs::read(&path).map(|b| hash_bytes(&b)).unwrap_or(0);

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

#[tauri::command(async)]
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

    /// 저장할 때마다 "밖에서 바뀌었다" 가 뜨던 문제. 감시 스레드가 우리보다
    /// 먼저 파일을 읽는 상황을 그대로 재현한다.
    #[test]
    fn 저장_전에_알려_두면_자기_저장은_걸러진다() {
        let p = tmp("expect");
        let mut st = watched_with(&p, b"first");

        // write_file 이 하는 순서: (1) 미리 알린다 (2) 쓴다
        note_expected(&mut st, &p, b"second");
        std::fs::write(&p, b"second").unwrap();

        assert!(!changed(&mut st, &key(&p)), "우리가 쓴 것은 알리지 않는다");
        // 그 다음 진짜 외부 변경은 정상적으로 잡혀야 한다
        std::fs::write(&p, b"third").unwrap();
        assert!(changed(&mut st, &key(&p)), "진짜 외부 변경은 알린다");
    }

    /// 왜 순서가 중요한지 못 박아 둔다 — 쓰고 나서 알리면 이미 늦다.
    #[test]
    fn 쓰고_나서_알리면_늦다() {
        let p = tmp("late");
        let mut st = watched_with(&p, b"first");

        std::fs::write(&p, b"second").unwrap();
        // 여기서 감시 스레드가 먼저 깨면(실제로 거의 항상 그렇다) 외부 변경으로 본다
        assert!(changed(&mut st, &key(&p)), "늦게 알리면 자기 저장도 외부 변경이 된다");
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
        expect_write(&p, b"second");
        std::fs::write(&p, b"second").unwrap();
        let mut g = state().lock().unwrap();
        assert!(!changed(&mut g, &key(&p)), "우리가 쓴 것은 알리지 않는다");
    }
}
