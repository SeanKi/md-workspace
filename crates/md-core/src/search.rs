//! 저장소 전체에서 글자를 찾는다. **색인을 만들지 않는다.**
//!
//! 재어 보니 노트 저장소 하나(60개 문서, 1MB)를 통째로 훑는 데 80ms 였다.
//! 사람이 못 느끼는 시간이라 색인을 둘 이유가 없다. 색인을 두면
//!
//! - 한국어 토크나이저 문제가 생긴다(조사 때문에 "검색어"로 "검색어를"이 안 걸린다).
//!   부분 문자열로 찾으면 그 문제가 아예 없다
//! - 밖에서 파일이 바뀌면(VS Code, git pull) 색인이 낡는다. 안 만들면 안 틀린다
//!
//! 비용은 파일을 읽는 게 아니라 **폴더를 걷는 데서** 난다. `node_modules` 같은 것이
//! 섞인 트리는 걷기만 해도 수십 초다. 그래서 걸러내는 목록이 이 파일의 핵심이다.

use serde::Serialize;
use std::path::Path;
use std::time::Instant;

/// 걷지 않는 폴더. 노트 저장소에 이런 것이 섞여 있어도 검색이 느려지지 않게 한다.
const SKIP_DIRS: [&str; 6] = ["node_modules", "target", "dist", "build", ".git", ".obsidian"];
const MD_EXT: [&str; 3] = ["md", "markdown", "mdx"];

/// 한 파일에서 이만큼만. 같은 낱말이 수백 번 나오는 문서가 결과를 다 차지하면 안 된다.
const PER_FILE: usize = 20;
const TOTAL: usize = 300;
/// 이보다 큰 파일은 건너뛴다. 노트가 아니라 붙여 넣은 로그 덩어리다.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct Hit {
    pub path: String,
    pub name: String,
    pub line_no: usize,
    /// 미리보기 (너무 길면 잘라낸다)
    pub line: String,
    /// `line` 안에서 맞은 자리 — 화면에서 색칠하는 데 쓴다
    pub start: usize,
    pub end: usize,
    pub score: i32,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub hits: Vec<Hit>,
    /// 맞은 파일 수
    pub files: usize,
    /// 읽어 본 파일 수
    pub scanned: usize,
    /// 상한에 걸려 잘렸는가
    pub truncated: bool,
    pub ms: u64,
}

fn is_markdown(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| MD_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            collect(&path, out);
        } else if is_markdown(&path) {
            out.push(path);
        }
    }
}

/// 미리보기 줄을 적당히 자른다. 맞은 자리가 보이도록 그 앞부터 잘라낸다.
fn preview(line: &str, at: usize, len: usize) -> (String, usize, usize) {
    const WIDTH: usize = 160;
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= WIDTH {
        return (line.to_string(), at, at + len);
    }
    let from = at.saturating_sub(40);
    let to = (from + WIDTH).min(chars.len());
    let mut s: String = chars[from..to].iter().collect();
    if from > 0 {
        s.insert_str(0, "…");
    }
    let shift = if from > 0 { from.saturating_sub(1) } else { 0 };
    (s, at - shift, at - shift + len)
}

/// 파일명 · 제목줄에 맞으면 점수를 더 준다. 대개 그런 문서를 찾고 있다.
fn score_of(name_hit: bool, line: &str) -> i32 {
    let mut s = 1;
    if name_hit {
        s += 100;
    }
    if line.trim_start().starts_with('#') {
        s += 20;
    }
    s
}

#[tauri::command]
pub fn search_repo(root: String, query: String) -> Result<SearchResult, String> {
    let started = Instant::now();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Err("찾을 말을 입력하세요.".into());
    }

    let mut files = Vec::new();
    collect(Path::new(&root), &mut files);
    files.sort();

    let mut hits: Vec<Hit> = Vec::new();
    let mut matched_files = 0usize;
    let mut scanned = 0usize;
    let mut truncated = false;

    for path in &files {
        if hits.len() >= TOTAL {
            truncated = true;
            break;
        }
        if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else { continue };
        scanned += 1;

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let name_hit = name.to_lowercase().contains(&needle);

        let mut in_file = 0usize;
        for (i, line) in text.lines().enumerate() {
            if in_file >= PER_FILE || hits.len() >= TOTAL {
                break;
            }
            let lower = line.to_lowercase();
            let Some(byte_at) = lower.find(&needle) else { continue };
            // 글자 수 기준으로 바꿔야 화면에서 색칠할 자리가 맞는다
            let at = lower[..byte_at].chars().count();
            let len = needle.chars().count();
            let (text_line, start, end) = preview(line, at, len);
            hits.push(Hit {
                path: path.to_string_lossy().to_string(),
                name: name.clone(),
                line_no: i + 1,
                line: text_line,
                start,
                end,
                score: score_of(name_hit, line),
            });
            in_file += 1;
        }
        // 본문에는 없어도 파일 이름이 맞으면 그 자체로 결과다
        if in_file == 0 && name_hit {
            hits.push(Hit {
                path: path.to_string_lossy().to_string(),
                name: name.clone(),
                line_no: 1,
                line: text.lines().next().unwrap_or("").to_string(),
                start: 0,
                end: 0,
                score: score_of(true, ""),
            });
            in_file += 1;
        }
        if in_file > 0 {
            matched_files += 1;
        }
    }

    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(a.path.cmp(&b.path))
            .then(a.line_no.cmp(&b.line_no))
    });

    Ok(SearchResult {
        hits,
        files: matched_files,
        scanned,
        truncated,
        ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(tag: &str, files: &[(&str, &str)]) -> String {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("mdsearch-{tag}-{n}"));
        for (rel, body) in files {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        root.to_string_lossy().to_string()
    }

    #[test]
    fn 조사가_붙어도_찾는다() {
        // 색인을 쓰지 않는 이유가 이것이다
        let root = make("josa", &[("a.md", "# 제목\n검색어를 찾는다\n관계없는 줄\n")]);
        let r = search_repo(root, "검색어".into()).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line_no, 2);
        assert_eq!(r.hits[0].line, "검색어를 찾는다");
        assert_eq!((r.hits[0].start, r.hits[0].end), (0, 3), "색칠할 자리는 글자 수 기준");
    }

    #[test]
    fn 파일이름과_제목에_가중치를_준다() {
        let root = make("score", &[
            ("보고서.md", "본문에는 없음\n"),
            ("other.md", "# 보고서 제목\n"),
            ("plain.md", "그냥 보고서 언급\n"),
        ]);
        let r = search_repo(root, "보고서".into()).unwrap();
        assert_eq!(r.files, 3);
        assert!(r.hits[0].name.contains("보고서"), "파일명 일치가 맨 위 -> {}", r.hits[0].name);
        let heading = r.hits.iter().position(|h| h.name == "other.md").unwrap();
        let plain = r.hits.iter().position(|h| h.name == "plain.md").unwrap();
        assert!(heading < plain, "제목줄이 본문보다 위");
    }

    #[test]
    fn 무거운_폴더는_걷지_않는다() {
        let root = make("skip", &[
            ("keep.md", "찾을말\n"),
            ("node_modules/x.md", "찾을말\n"),
            (".git/y.md", "찾을말\n"),
            ("sub/deep.md", "찾을말\n"),
        ]);
        let r = search_repo(root, "찾을말".into()).unwrap();
        let names: Vec<_> = r.hits.iter().map(|h| h.name.clone()).collect();
        assert_eq!(r.files, 2, "keep.md 와 sub/deep.md 만 -> {names:?}");
    }

    #[test]
    fn 대소문자를_가리지_않는다_빈_질의는_오류() {
        let root = make("case", &[("a.md", "Hello World\n")]);
        assert_eq!(search_repo(root.clone(), "hello".into()).unwrap().hits.len(), 1);
        assert_eq!(search_repo(root.clone(), "WORLD".into()).unwrap().hits.len(), 1);
        assert!(search_repo(root, "  ".into()).is_err());
    }

    #[test]
    fn 한_파일이_결과를_다_차지하지_않는다() {
        let body = "찾을말\n".repeat(100);
        let root = make("cap", &[("many.md", &body), ("one.md", "찾을말\n")]);
        let r = search_repo(root, "찾을말".into()).unwrap();
        let from_many = r.hits.iter().filter(|h| h.name == "many.md").count();
        assert_eq!(from_many, PER_FILE, "한 파일에서 최대 {PER_FILE}줄");
        assert!(r.hits.iter().any(|h| h.name == "one.md"), "다른 파일도 자리를 얻는다");
    }
}
