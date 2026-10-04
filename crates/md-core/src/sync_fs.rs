//! 동기화(`packages/sync-core`)가 쓰는 파일 조회. 읽기·쓰기·지우기는 `commands.rs` 것을 그대로 쓴다.

use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct MdFile {
    /// 저장소 기준 상대 경로. 구분자는 `/` — 기기(Windows·폰) 사이에서 같은 문서를 같은 키로 부른다
    pub rel: String,
    pub size: u64,
    /// 고친 시각 (ms)
    pub mtime: u64,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 저장소의 마크다운 전부 — 검색과 같은 규칙으로 걷는다(점 폴더·node_modules 등은 뺀다)
#[tauri::command(async)]
pub fn list_md(root: String) -> Result<Vec<MdFile>, String> {
    let base = Path::new(&root);
    if !base.is_dir() {
        return Err(format!("폴더가 없습니다: {root}"));
    }
    let mut paths = Vec::new();
    crate::search::collect(base, &mut paths);
    Ok(paths
        .into_iter()
        .filter_map(|p| {
            let m = std::fs::metadata(&p).ok()?;
            let rel = p.strip_prefix(base).ok()?.to_string_lossy().replace('\\', "/");
            Some(MdFile { rel, size: m.len(), mtime: mtime_ms(&m) })
        })
        .collect())
}

/// 파일 하나의 크기·시각. 없으면 null
#[tauri::command(async)]
pub fn stat_file(path: String) -> Option<FileStat> {
    let m = std::fs::metadata(&path).ok()?;
    m.is_file().then(|| FileStat { size: m.len(), mtime: mtime_ms(&m) })
}

/// 첨부 = 문서가 아닌 파일 전부 (그림 · PDF · 녹음 · 엑셀 …). 그림만 올렸더니 폴더의 일부만 원격에 갔다.
/// 문서(이 확장자)는 블록 단위로 따로 맞추므로 첨부에서 뺀다
const DOC_EXT: [&str; 3] = ["md", "markdown", "mdx"];
/// 쓰는 중인 임시 파일 — 올리면 반쯤 쓴 것이 간다
const TEMP_EXT: [&str; 5] = ["tmp", "temp", "part", "crdownload", "swp"];
/// 첨부를 찾을 때도 들어가지 않는 폴더. `.image` 같은 다른 점 폴더에는 들어간다 —
/// 붙여 넣은 그림은 문서 옆의 `.image/` 에 쌓인다
const ASSET_SKIP: [&str; 7] = [".mdsync", ".git", ".obsidian", ".mdtrash", ".trash", "node_modules", ".mdlog"];

fn collect_assets(dir: &Path, base: &Path, out: &mut Vec<MdFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if !ASSET_SKIP.contains(&name.as_str()) {
                collect_assets(&p, base, out);
            }
            continue;
        }
        let ext = p.extension().and_then(|x| x.to_str()).map(|x| x.to_lowercase()).unwrap_or_default();
        // 문서는 블록 단위로 따로 맞춘다. 오피스가 여는 동안 만드는 `~$문서.xlsx` · `~7900` 같은 임시 파일은 뺀다
        // 숨김 파일(`.gitignore` · `.DS_Store`)과 탐색기가 만드는 것도 뺀다
        let lower = name.to_lowercase();
        if DOC_EXT.contains(&ext.as_str()) || name.starts_with('~') || name.starts_with('.') || TEMP_EXT.contains(&ext.as_str())
            || lower == "thumbs.db" || lower == "desktop.ini"
        {
            continue;
        }
        let (Ok(m), Ok(rel)) = (e.metadata(), p.strip_prefix(base)) else { continue };
        out.push(MdFile { rel: rel.to_string_lossy().replace('\\', "/"), size: m.len(), mtime: mtime_ms(&m) });
    }
}

/// 저장소의 첨부 파일 전부 — 문서가 아닌 것 (점 폴더 `.image` 포함)
#[tauri::command(async)]
pub fn list_assets(root: String) -> Result<Vec<MdFile>, String> {
    let base = Path::new(&root);
    if !base.is_dir() {
        return Err(format!("폴더가 없습니다: {root}"));
    }
    let mut out = Vec::new();
    collect_assets(base, base, &mut out);
    Ok(out)
}

/* ---------- 지운 그림 — 문서에서 빠진 그림을 `.mdtrash/` 로 ---------- */

/// 그림 옆의 휴지통 자리. `.mdtrash` 는 동기화(`ASSET_SKIP`)와 검색에서 빠진다
fn trash_of(path: &Path) -> Result<std::path::PathBuf, String> {
    let parent = path.parent().ok_or("상위 폴더가 없습니다")?;
    let name = path.file_name().ok_or("파일 이름이 없습니다")?;
    Ok(parent.join(".mdtrash").join(name))
}

/// `root` 아래 마크다운 중 `names` 의 어느 하나라도 적힌 문서 (`except` 는 빼고).
/// 그림 이름은 시각이 붙어 저장소 안에서 겹치지 않으므로 이름만 찾아도 충분하다
#[tauri::command(async)]
pub fn asset_users(root: String, names: Vec<String>, except: Option<String>) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    crate::search::collect(Path::new(&root), &mut files);
    let except = except.map(|e| e.replace('\\', "/").to_lowercase());
    Ok(files
        .into_iter()
        .filter(|p| except.as_deref() != Some(p.to_string_lossy().replace('\\', "/").to_lowercase().as_str()))
        .filter(|p| std::fs::read_to_string(p).map(|t| names.iter().any(|n| t.contains(n.as_str()))).unwrap_or(false))
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// 그림을 옆의 `.mdtrash/` 로 옮긴다. 되돌리기로 다시 나타나면 `asset_restore` 가 꺼낸다
#[tauri::command(async)]
pub fn asset_to_trash(path: String) -> Result<(), String> {
    let from = Path::new(&path);
    if !from.is_file() {
        return Ok(());
    }
    let to = trash_of(from)?;
    std::fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
    if to.exists() {
        std::fs::remove_file(&to).map_err(|e| e.to_string())?;
    }
    std::fs::rename(from, &to).map_err(|e| format!("{path} 를 휴지통으로 옮기지 못했습니다: {e}"))
}

/// 휴지통에 있으면 제자리로. 꺼냈으면 true
#[tauri::command(async)]
pub fn asset_restore(path: String) -> Result<bool, String> {
    let to = Path::new(&path);
    let from = trash_of(to)?;
    if to.exists() || !from.is_file() {
        return Ok(false);
    }
    std::fs::rename(&from, to).map_err(|e| format!("{path} 를 되살리지 못했습니다: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trash_and_restore() {
        let dir = std::env::temp_dir().join(format!("mdcore-asset-{}", std::process::id()));
        let img = dir.join(".image");
        std::fs::create_dir_all(&img).unwrap();
        std::fs::write(dir.join("a.md"), "![](.image/x.png)").unwrap();
        std::fs::write(dir.join("b.md"), "글").unwrap();
        let x = img.join("x.png");
        std::fs::write(&x, b"png").unwrap();
        let root = dir.to_string_lossy().to_string();
        let a = dir.join("a.md").to_string_lossy().to_string();

        assert_eq!(asset_users(root.clone(), vec!["x.png".into()], None).unwrap().len(), 1);
        assert!(asset_users(root, vec!["x.png".into()], Some(a)).unwrap().is_empty());

        let p = x.to_string_lossy().to_string();
        asset_to_trash(p.clone()).unwrap();
        assert!(!x.exists() && img.join(".mdtrash/x.png").exists());
        assert!(asset_restore(p.clone()).unwrap());
        assert!(x.exists());
        assert!(!asset_restore(p).unwrap());
        std::fs::remove_dir_all(&dir).ok();
    }
}
