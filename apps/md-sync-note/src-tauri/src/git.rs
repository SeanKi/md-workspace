//! 저장소별 로컬 Git. 자동 저장이 실제로 저장을 했을 때 커밋까지 이어붙인다.
//!
//! libgit2(git2 크레이트) 대신 설치된 `git` 실행 파일을 부른다.
//! - 빌드가 무거워지지 않는다(git2 는 C 라이브러리를 함께 컴파일한다)
//! - 자격증명·훅·gitignore 처리가 사용자의 git 설정과 정확히 같다
//! 대신 git 이 설치돼 있어야 한다. 없으면 has_git=false 로 알려주고 조용히 넘어간다.

use serde::Serialize;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
/// 콘솔 창이 깜빡이지 않게 한다 (CREATE_NO_WINDOW)
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Default)]
pub struct GitStatus {
    /// git 실행 파일이 있는가
    pub has_git: bool,
    /// git 저장소 안에 있는가 (상위 폴더의 저장소일 수도 있다)
    pub is_repo: bool,
    /// 이 폴더 자체가 저장소 루트인가
    pub is_root: bool,
    /// 저장소 루트 경로. 등록한 폴더와 다르면 화면에 알려준다
    pub root: String,
    /// 현재 브랜치 (커밋이 하나도 없으면 예정 브랜치 이름)
    pub branch: String,
    /// 이 폴더 아래의 커밋되지 않은 변경 개수
    pub changes: u32,
}

fn git(dir: &str, args: &[&str]) -> Result<(bool, String), String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    cmd.creation_flags(NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("git 실행 실패: {e}"))?;
    let text = if out.status.success() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        String::from_utf8_lossy(&out.stderr).trim().to_string()
    };
    Ok((out.status.success(), text))
}

fn has_git() -> bool {
    let mut cmd = Command::new("git");
    cmd.arg("--version");
    #[cfg(windows)]
    cmd.creation_flags(NO_WINDOW);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

/// 이 폴더를 품고 있는 저장소의 루트. 저장소 안이 아니면 None.
fn repo_root(path: &str) -> Option<String> {
    match git(path, &["rev-parse", "--show-toplevel"]) {
        Ok((true, top)) if !top.is_empty() => Some(top),
        _ => None,
    }
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

#[tauri::command(async)]
pub fn git_status(path: String) -> GitStatus {
    if !has_git() {
        return GitStatus::default();
    }
    let Some(root) = repo_root(&path) else {
        return GitStatus { has_git: true, ..Default::default() };
    };
    let branch = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .filter(|(ok, _)| *ok)
        .map(|(_, s)| s)
        // 커밋이 하나도 없으면 위 명령이 실패한다. 예정 브랜치 이름을 대신 보여준다.
        .unwrap_or_else(|| {
            git(&path, &["symbolic-ref", "--short", "HEAD"])
                .map(|(_, s)| s)
                .unwrap_or_default()
        });
    let changes = git(&path, &["status", "--porcelain", "--", "."])
        .map(|(_, s)| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);
    GitStatus {
        has_git: true,
        is_repo: true,
        is_root: same_path(&root, &path),
        root,
        branch,
        changes,
    }
}

/// 저장소로 만들고 첫 커밋까지 한다.
/// 커밋 이름/메일이 없으면 이 저장소에만 임시값을 넣는다(전역 설정은 건드리지 않는다).
#[tauri::command(async)]
pub fn git_init(path: String) -> Result<String, String> {
    if !has_git() {
        return Err("git 을 찾을 수 없습니다. Git for Windows 를 설치해 주세요.".into());
    }
    if let Some(root) = repo_root(&path) {
        return Err(format!("이미 git 저장소 안입니다: {root}"));
    }
    let (ok, msg) = git(&path, &["init"])?;
    if !ok {
        return Err(msg);
    }
    ensure_identity(&path)?;
    let (_, out) = commit_all(&path, "MDSyncNote: 저장소 초기화")?;
    Ok(format!("git 저장소를 만들었습니다. {out}"))
}

/// user.name / user.email 이 없으면 커밋이 실패한다. 저장소 안에서만 채워 넣는다.
fn ensure_identity(path: &str) -> Result<(), String> {
    for (key, val) in [("user.name", "MDSyncNote"), ("user.email", "mdsyncnote@localhost")] {
        let (ok, cur) = git(path, &["config", key])?;
        if !ok || cur.is_empty() {
            git(path, &["config", "--local", key, val])?;
        }
    }
    Ok(())
}

/// 등록한 폴더 아래(`-- .`)만 스테이징하고 커밋한다.
/// 저장소 루트가 더 위에 있어도 바깥의 다른 작업을 휩쓸어 담지 않는다.
fn commit_all(path: &str, message: &str) -> Result<(bool, String), String> {
    let (ok, err) = git(path, &["add", "-A", "--", "."])?;
    if !ok {
        return Err(err);
    }
    let (_, dirty) = git(path, &["status", "--porcelain", "--", "."])?;
    if dirty.trim().is_empty() {
        return Ok((false, "변경 없음".into()));
    }
    let (ok, out) = git(path, &["commit", "-m", message, "--", "."])?;
    if !ok {
        return Err(out);
    }
    let (_, hash) = git(path, &["rev-parse", "--short", "HEAD"])?;
    Ok((true, format!("커밋 {hash}")))
}

#[derive(Serialize)]
pub struct CommitResult {
    pub committed: bool,
    pub detail: String,
}

/// 저장 후 호출한다. 변경이 없으면 아무것도 하지 않는다.
/// 저장소가 아니거나 git 이 없으면 조용히 넘어간다(저장 자체는 이미 끝났다).
#[tauri::command(async)]
pub fn git_commit(path: String, message: String) -> Result<CommitResult, String> {
    if !has_git() || repo_root(&path).is_none() {
        return Ok(CommitResult { committed: false, detail: String::new() });
    }
    ensure_identity(&path)?;
    let (committed, detail) = commit_all(&path, &message)?;
    Ok(CommitResult { committed, detail })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 겹치지 않는 임시 폴더. git 이 없는 환경에서는 테스트를 건너뛴다.
    fn tmp(tag: &str) -> String {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mdsync-{tag}-{n}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn 저장소가_아니면_커밋하지_않는다() {
        if !has_git() {
            return;
        }
        let dir = tmp("plain");
        std::fs::write(format!("{dir}/a.md"), "# a").unwrap();

        let st = git_status(dir.clone());
        assert!(st.has_git);
        assert!(!st.is_repo, "빈 폴더는 저장소가 아니다");

        let r = git_commit(dir.clone(), "무시돼야 함".into()).unwrap();
        assert!(!r.committed, "저장소가 아니면 조용히 넘어간다");
    }

    #[test]
    fn 초기화하고_변경이_있을_때만_커밋한다() {
        if !has_git() {
            return;
        }
        let dir = tmp("init");
        std::fs::write(format!("{dir}/a.md"), "# a").unwrap();

        git_init(dir.clone()).expect("init 성공");
        let st = git_status(dir.clone());
        assert!(st.is_repo && st.is_root);
        assert_eq!(st.changes, 0, "초기화가 첫 커밋까지 끝낸다");

        // 두 번째 init 은 막힌다
        assert!(git_init(dir.clone()).is_err());

        // 변경이 없으면 커밋하지 않는다
        let r = git_commit(dir.clone(), "변경 없음".into()).unwrap();
        assert!(!r.committed);

        // 변경이 있으면 커밋한다
        std::fs::write(format!("{dir}/a.md"), "# a 고침").unwrap();
        assert_eq!(git_status(dir.clone()).changes, 1);
        let r = git_commit(dir.clone(), "고침".into()).unwrap();
        assert!(r.committed, "{}", r.detail);
        assert_eq!(git_status(dir.clone()).changes, 0);
    }

    #[test]
    fn 하위폴더는_상위_저장소를_쓰고_바깥을_건드리지_않는다() {
        if !has_git() {
            return;
        }
        let root = tmp("nested");
        std::fs::write(format!("{root}/outside.md"), "# 바깥").unwrap();
        git_init(root.clone()).unwrap();

        let sub = format!("{root}/notes");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(format!("{sub}/b.md"), "# b").unwrap();
        // 저장소 루트 바깥(상위)에도 변경을 하나 만들어 둔다
        std::fs::write(format!("{root}/outside.md"), "# 바깥 고침").unwrap();

        let st = git_status(sub.clone());
        assert!(st.is_repo && !st.is_root, "상위 저장소를 인식한다");
        assert_eq!(st.changes, 1, "하위 폴더 안의 변경만 센다");

        let r = git_commit(sub.clone(), "하위만".into()).unwrap();
        assert!(r.committed);
        // 바깥 변경은 그대로 남아 있어야 한다
        let (_, all) = git(&root, &["status", "--porcelain"]).unwrap();
        assert!(all.contains("outside.md"), "바깥 변경을 휩쓸어 담지 않는다: {all}");
    }
}
