@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "LOG=%~dp0build-log.txt"
title portable 실행 파일 빌드

rem 설치본(NSIS) 없이 단일 exe 두 개만 만든다.
rem 설치 프로그램까지 필요하면 build-all.bat 을 쓸 것.

echo ============================================
echo   portable 실행 파일 빌드 (설치본 없음)
echo ============================================
echo.

> "%LOG%" echo === %DATE% %TIME% ===

where node >nul 2>nul
if errorlevel 1 ( echo   [X] Node.js 가 없습니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요. & pause & exit /b 1 )
where cargo >nul 2>nul
if errorlevel 1 ( echo   [X] Rust 가 없습니다. https://rustup.rs 에서 설치 후 다시 실행하세요. & pause & exit /b 1 )

rem node_modules 폴더가 있어도 워크스페이스 링크가 없으면 vite 가 죽는다.
echo [1/3] npm 패키지 확인...
call npm install >> "%LOG%" 2>&1
if not exist "node_modules\@md\editor-core\package.json" (
  echo   [!] 워크스페이스 링크가 없습니다. node_modules 를 다시 만듭니다...
  if exist node_modules rmdir /s /q node_modules
  call npm install >> "%LOG%" 2>&1
)
if not exist "node_modules\@md\editor-core\package.json" (
  echo   [X] npm install 실패. 로그 마지막 30 줄:
  powershell -NoProfile -Command "Get-Content -Tail 30 '%LOG%'"
  pause & exit /b 1
)

echo [2/3] MD Notepad 빌드... (처음이면 5~15 분)
call npm run tauri -w md-editor -- build --no-bundle >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] 실패. 로그 마지막 30 줄:
  powershell -NoProfile -Command "Get-Content -Tail 30 '%LOG%'"
  pause & exit /b 1
)

echo [3/3] MDSyncNote 빌드...
call npm run tauri -w md-sync-note -- build --no-bundle >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] 실패. 로그 마지막 30 줄:
  powershell -NoProfile -Command "Get-Content -Tail 30 '%LOG%'"
  pause & exit /b 1
)

set "OUT=%~dp0release-out"
if not exist "%OUT%" mkdir "%OUT%"
copy /y "target\release\md-editor.exe"    "%OUT%\MD-Notepad-portable.exe"  >nul
copy /y "target\release\md-sync-note.exe" "%OUT%\MDSyncNote-portable.exe" >nul

echo.
echo ============================================
echo   완료: %OUT%
echo ============================================
dir /b "%OUT%"
explorer "%OUT%"
pause
