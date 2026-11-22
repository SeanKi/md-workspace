//! 저장소 찾기 색인 — SQLite FTS5 (trigram). `search.rs` 의 직접 훑기를 빠르게 하려고 둔 **사본**이다.
//!
//! 왜: 직접 훑기는 찾을 때마다 저장소의 문서를 전부 디스크에서 읽는다. 실제 저장소 8개에서 한 번 찾는 데
//! 30초쯤 걸렸다(`.mdlog` — 큰 저장소 하나에 7초 넘게). 색인은 글을 한 파일에 담아 두고, 바뀐 문서만
//! 다시 읽는다(크기 · 수정 시각이 같으면 안 읽는다 — nexus-base 의 색인 방식과 같다).
//!
//! 지키는 것
//! - **SQLite 는 실행 파일 안에 들어 있다** (`rusqlite` bundled). 따로 DLL 이 없어 "DLL 이 없어 앱이 안 뜨는" 일이 없다
//! - 색인을 못 쓰면(폴더를 못 만듦 · 파일이 깨짐 · FTS5 없음) **None** 을 돌려주고, 부르는 쪽이 직접 훑기로 간다.
//!   앱이 뜨는 데는 아무 영향이 없다 — 색인은 처음 찾을 때 연다
//! - 깨진 색인 파일은 지우고 한 번 다시 만든다 (사본이니 잃을 것이 없다)
//! - 색인은 저장소 폴더가 아니라 **앱 데이터 폴더**에 둔다 — 저장소에 쓰면 폴더 감시 · 동기화가 그것을 또 본다
//! - trigram 은 한국어 조사 문제가 없다("검색어" 로 "검색어를"). 대신 **3글자 미만은 색인으로 못 찾아서**
//!   담아 둔 글에서 직접 대조한다 — 그래도 디스크를 다시 읽지 않으니 빠르다
//!
//! 언제 새로 맞추나: 처음 찾을 때 한 번(그 저장소가 색인에 없으면 기다렸다가 찾는다), 그 뒤로는 **찾을 때마다
//! 뒤에서** 바뀐 것을 맞추고, 무엇이 바뀌었으면 `search-index-changed` 를 알린다 → 화면이 한 번 더 찾는다.
//! 앱이 뜰 때 `search_warm` 으로 미리 맞춰 두면 첫 찾기도 빠르다.

use crate::search::{collect, file_hits, sort_hits, Hit, SearchResult, LIMITS};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const FILE: &str = "search-index.sqlite";
/// 표 모양을 바꾸면 올린다 — 옛 색인은 지우고 다시 만든다
const SCHEMA: i64 = 1;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static DB: OnceLock<Option<Mutex<Connection>>> = OnceLock::new();
/// 뒤에서 맞추는 중인 저장소 — 같은 저장소를 겹쳐 맞추지 않는다
static BUSY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Clone, Serialize)]
pub struct IndexChanged {
    pub root: String,
}

/// 색인을 둘 폴더 (폰: 앱 데이터 폴더). 정하지 않으면 `%LOCALAPPDATA%\MdWorkspace`
pub fn set_index_dir(dir: PathBuf) {
    let _ = DIR.set(dir);
}

fn index_path() -> Option<PathBuf> {
    let dir = DIR.get().cloned().or_else(|| {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("MdWorkspace"))
    })?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(FILE))
}

fn open_at(path: &Path) -> Result<Connection, String> {
    let c = Connection::open(path).map_err(|e| e.to_string())?;
    c.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    // WAL: 찾기(읽기)와 맞추기(쓰기)가 서로를 덜 기다린다. 로컬 디스크라 안전하다
    let _ = c.pragma_update(None, "journal_mode", "WAL");
    let _ = c.pragma_update(None, "synchronous", "NORMAL");
    let ver: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(|e| e.to_string())?;
    if ver != SCHEMA {
        c.execute_batch("DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS roots;")
            .map_err(|e| e.to_string())?;
    }
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS files(
             id INTEGER PRIMARY KEY, root TEXT NOT NULL, path TEXT NOT NULL,
             size INTEGER NOT NULL, mtime INTEGER NOT NULL, UNIQUE(root, path));
         CREATE TABLE IF NOT EXISTS roots(root TEXT PRIMARY KEY, scanned INTEGER NOT NULL);
         CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(name, body, tokenize='trigram');",
    )
    .map_err(|e| format!("FTS5 색인을 만들 수 없습니다: {e}"))?;
    c.pragma_update(None, "user_version", SCHEMA).map_err(|e| e.to_string())?;
    // 정말 쓸 수 있는지 한 번 물어본다 — 깨진 파일은 여기서 드러난다
    c.query_row("SELECT count(*) FROM docs WHERE docs MATCH '\"abc\"'", [], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    Ok(c)
}

/// 색인을 연다. 실패하면 깨진 파일을 지우고 한 번 더. 그래도 안 되면 None — 직접 훑기로 간다
fn db() -> Option<&'static Mutex<Connection>> {
    DB.get_or_init(|| {
        let path = index_path()?;
        let c = open_at(&path).or_else(|_| {
            for ext in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
            }
            open_at(&path)
        });
        c.ok().map(Mutex::new)
    })
    .as_ref()
}

fn busy() -> &'static Mutex<HashSet<String>> {
    BUSY.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 폴더와 색인을 맞춘다. 바뀐(더함 · 고침 · 지움) 문서 수를 돌려준다.
/// 폴더를 걷고 바뀐 파일을 읽는 동안에는 색인을 잠그지 않는다 — 그동안에도 찾기가 된다
fn reconcile(m: &Mutex<Connection>, root: &str) -> Result<usize, String> {
    let (max_bytes, _) = LIMITS;
    // 1) 지금 색인에 든 것
    let known: HashMap<String, (i64, i64, i64)> = {
        let c = m.lock().map_err(|e| e.to_string())?;
        let mut st = c.prepare("SELECT path, id, size, mtime FROM files WHERE root = ?1").map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![root], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    // 폴더가 없다(빠진 드라이브 · 네트워크 끊김) — 지운 것으로 치지 않고 그대로 둔다
    if !Path::new(root).is_dir() {
        return Ok(0);
    }
    // 2) 폴더를 걷고, 크기 · 시각이 다른 것만 읽는다 (잠그지 않고)
    let mut paths = Vec::new();
    collect(Path::new(root), &mut paths);
    let mut seen = HashSet::new();
    let mut changed: Vec<(String, String, i64, i64, String, Option<i64>)> = Vec::new(); // path, name, size, mtime, text, id
    for p in &paths {
        let Ok(meta) = std::fs::metadata(p) else { continue };
        if meta.len() > max_bytes {
            continue;
        }
        let key = p.to_string_lossy().to_string();
        let (size, mtime) = (meta.len() as i64, mtime_ms(&meta));
        seen.insert(key.clone());
        let old = known.get(&key);
        if matches!(old, Some((_, s, t)) if *s == size && *t == mtime) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(p) else { continue };
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        changed.push((key, name, size, mtime, text, old.map(|o| o.0)));
    }
    let gone: Vec<i64> = known.iter().filter(|(k, _)| !seen.contains(*k)).map(|(_, v)| v.0).collect();
    // 3) 한 번에 적는다
    let mut c = m.lock().map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    for (path, name, size, mtime, text, id) in &changed {
        match id {
            Some(id) => {
                tx.execute("UPDATE files SET size = ?2, mtime = ?3 WHERE id = ?1", params![id, size, mtime])
                    .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM docs WHERE rowid = ?1", params![id]).map_err(|e| e.to_string())?;
                tx.execute("INSERT INTO docs(rowid, name, body) VALUES (?1, ?2, ?3)", params![id, name, text])
                    .map_err(|e| e.to_string())?;
            }
            None => {
                tx.execute("INSERT INTO files(root, path, size, mtime) VALUES (?1, ?2, ?3, ?4)", params![root, path, size, mtime])
                    .map_err(|e| e.to_string())?;
                let id = tx.last_insert_rowid();
                tx.execute("INSERT INTO docs(rowid, name, body) VALUES (?1, ?2, ?3)", params![id, name, text])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    for id in &gone {
        tx.execute("DELETE FROM files WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM docs WHERE rowid = ?1", params![id]).map_err(|e| e.to_string())?;
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    tx.execute("INSERT INTO roots(root, scanned) VALUES (?1, ?2) ON CONFLICT(root) DO UPDATE SET scanned = ?2", params![root, now])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed.len() + gone.len())
}

/// 뒤에서 맞춘다. 무엇이 바뀌었으면 화면에 알린다 (화면이 한 번 더 찾는다)
fn reconcile_later(app: &AppHandle, root: &str) {
    let Some(m) = db() else { return };
    {
        let Ok(mut b) = busy().lock() else { return };
        if !b.insert(root.to_string()) {
            return; // 이미 맞추는 중
        }
    }
    let app = app.clone();
    let root = root.to_string();
    std::thread::spawn(move || {
        let r = reconcile(m, &root);
        if let Ok(mut b) = busy().lock() {
            b.remove(&root);
        }
        if matches!(r, Ok(n) if n > 0) {
            let _ = app.emit("search-index-changed", IndexChanged { root });
        }
    });
}

fn is_indexed(m: &Mutex<Connection>, root: &str) -> bool {
    m.lock()
        .ok()
        .and_then(|c| c.query_row("SELECT 1 FROM roots WHERE root = ?1", params![root], |_| Ok(())).ok())
        .is_some()
}

/// 색인으로 찾는다. 색인을 못 쓰면 None
pub fn search(app: &AppHandle, root: &str, query: &str) -> Option<SearchResult> {
    let started = Instant::now();
    let m = db()?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    // 처음 보는 저장소 — 지금 맞춘다 (한 번은 직접 훑기만큼 걸린다). 이미 있으면 바로 찾고 뒤에서 맞춘다
    if !is_indexed(m, root) {
        reconcile(m, root).ok()?;
    } else {
        reconcile_later(app, root);
    }
    find(m, root, &needle, started).ok()
}

fn find(m: &Mutex<Connection>, root: &str, needle: &str, started: Instant) -> Result<SearchResult, String> {
    let (_, total) = LIMITS;
    let c = m.lock().map_err(|e| e.to_string())?;
    // 3글자 이상은 trigram 색인으로. 큰따옴표로 감싸 한 덩어리 글자로 — 사용자가 친 AND · - · * 가 FTS 문법이 되지 않게
    let (sql, arg) = if needle.chars().count() >= 3 {
        (
            "SELECT f.path, f.mtime, d.name, d.body FROM docs d JOIN files f ON f.id = d.rowid
             WHERE f.root = ?1 AND docs MATCH ?2 ORDER BY f.path",
            format!("\"{}\"", needle.replace('"', "\"\"")),
        )
    } else {
        // 짧은 말은 색인으로 못 찾는다 — 담아 둔 글에서 직접 (디스크는 다시 읽지 않는다)
        (
            "SELECT f.path, f.mtime, d.name, d.body FROM docs d JOIN files f ON f.id = d.rowid
             WHERE f.root = ?1 AND (instr(lower(d.body), ?2) > 0 OR instr(lower(d.name), ?2) > 0) ORDER BY f.path",
            needle.to_string(),
        )
    };
    let mut st = c.prepare(sql).map_err(|e| e.to_string())?;
    let rows = st
        .query_map(params![root, arg], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })
        .map_err(|e| e.to_string())?;
    let mut hits: Vec<Hit> = Vec::new();
    let mut matched = 0usize;
    let mut truncated = false;
    for row in rows.flatten() {
        if hits.len() >= total {
            truncated = true;
            break;
        }
        let (path, mtime, name, body) = row;
        if file_hits(&path, &name, mtime / 1000, &body, needle, &mut hits) > 0 {
            matched += 1;
        }
    }
    let scanned: i64 = c
        .query_row("SELECT count(*) FROM files WHERE root = ?1", params![root], |r| r.get(0))
        .unwrap_or(0);
    sort_hits(&mut hits);
    Ok(SearchResult {
        hits,
        files: matched,
        scanned: scanned as usize,
        truncated,
        ms: started.elapsed().as_millis() as u64,
        indexed: true,
    })
}

/// 앱이 뜰 때 저장소들을 뒤에서 미리 맞춰 둔다 — 첫 찾기도 빠르게. 색인을 못 쓰면 아무 일도 안 한다
#[tauri::command(async)]
pub fn search_warm(app: AppHandle, roots: Vec<String>) {
    let Some(m) = db() else { return };
    std::thread::spawn(move || {
        for root in roots {
            {
                let Ok(mut b) = busy().lock() else { return };
                if !b.insert(root.clone()) {
                    continue;
                }
            }
            let r = reconcile(m, &root);
            if let Ok(mut b) = busy().lock() {
                b.remove(&root);
            }
            if matches!(r, Ok(n) if n > 0) {
                let _ = app.emit("search-index-changed", IndexChanged { root });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("mdidx-{tag}-{n}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn hits_of(m: &Mutex<Connection>, root: &str, q: &str) -> Vec<(String, usize)> {
        find(m, root, &q.to_lowercase(), Instant::now())
            .unwrap()
            .hits
            .into_iter()
            .map(|h| (h.name, h.line_no))
            .collect()
    }

    #[test]
    fn 색인과_직접_훑기가_같은_결과를_낸다_그리고_바뀐_것만_다시_읽는다() {
        let root = tmp("repo");
        std::fs::create_dir_all(root.join("하위")).unwrap();
        std::fs::write(root.join("a.md"), "# 통신 장애\n검색어를 찾는다\nNG 버퍼\n").unwrap();
        std::fs::write(root.join("하위").join("보고서.md"), "본문\nPanelID 누락\n").unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules").join("x.md"), "검색어").unwrap();
        let r = root.to_string_lossy().to_string();
        let m = Mutex::new(open_at(&tmp("db").join(FILE)).unwrap());

        assert_eq!(reconcile(&m, &r).unwrap(), 2);
        for q in ["검색어", "통신 장애", "PANELID", "보고서", "NG"] {
            let mut want: Vec<_> = crate::search::scan_search(r.clone(), q.into()).unwrap().hits.into_iter().map(|h| (h.name, h.line_no)).collect();
            let mut got = hits_of(&m, &r, q);
            want.sort();
            got.sort();
            assert_eq!(got, want, "질의 {q}");
        }
        // 그대로면 아무것도 안 읽는다
        assert_eq!(reconcile(&m, &r).unwrap(), 0);
        // 고침 · 지움이 반영된다
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(root.join("a.md"), "# 다른 글\n새 낱말\n").unwrap();
        std::fs::remove_file(root.join("하위").join("보고서.md")).unwrap();
        assert_eq!(reconcile(&m, &r).unwrap(), 2);
        assert!(hits_of(&m, &r, "검색어").is_empty());
        assert_eq!(hits_of(&m, &r, "새 낱말"), vec![("a.md".to_string(), 2)]);
        assert!(hits_of(&m, &r, "PanelID").is_empty());
        // FTS 문법이 섞인 말도 그냥 글자로
        assert!(hits_of(&m, &r, "\"a OR b*").is_empty());
    }

    #[test]
    fn 폴더가_사라지면_색인을_지우지_않는다() {
        let root = tmp("gone");
        std::fs::write(root.join("a.md"), "남겨 둘 글\n").unwrap();
        let r = root.to_string_lossy().to_string();
        let m = Mutex::new(open_at(&tmp("db2").join(FILE)).unwrap());
        reconcile(&m, &r).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(reconcile(&m, &r).unwrap(), 0);
        assert_eq!(hits_of(&m, &r, "남겨 둘").len(), 1);
    }

    #[test]
    fn 깨진_색인_파일은_다시_만든다() {
        let p = tmp("bad").join(FILE);
        std::fs::write(&p, b"this is not a sqlite database at all, just junk bytes......").unwrap();
        assert!(open_at(&p).is_err());
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", p.display()));
        }
        assert!(open_at(&p).is_ok());
    }
}
