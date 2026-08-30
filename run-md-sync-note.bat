@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "LOG=%~dp0run-log.txt"
title MDSyncNote

echo ============================================
echo   MDSyncNote
echo ============================================
echo.

> "%LOG%" echo === %DATE% %TIME% ===

echo [1/4] Node.js 확인...
where node >nul 2>nul
if errorlevel 1 ( echo   [X] Node.js 가 없습니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요. & pause & exit /b 1 )
for /f "delims=" %%v in ('node -v') do echo   [O] Node %%v

echo [2/4] Visual Studio C++ 빌드 도구 확인...
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "HASVC="
if exist "%VSWHERE%" (
  for /f "delims=" %%p in ('"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul') do set "HASVC=%%p"
)
if defined HASVC (
  echo   [O] 설치됨
) else (
  echo   [!] 없습니다. winget 으로 설치합니다. 수 GB, 10~20분.
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
)

echo [3/4] Rust 확인...
where cargo >nul 2>nul
if errorlevel 1 (
  echo   [!] 없습니다. winget 으로 설치합니다.
  winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)
where cargo >nul 2>nul
if errorlevel 1 ( echo   [X] Rust 설치 실패. https://rustup.rs 에서 rustup-init.exe 를 받아 설치하세요. & pause & exit /b 1 )
for /f "delims=" %%v in ('cargo --version') do echo   [O] %%v

rem ---- 워크스페이스 링크 확인 ----
rem node_modules 폴더가 있어도 워크스페이스 링크(@md\editor-core)가 없으면
rem "@md/editor-core 를 찾을 수 없다" 며 vite 가 실패한다. 폴더 유무가 아니라
rem 링크 유무로 판단해야 한다.
echo [4/4] npm 패키지 확인...
call npm install >> "%LOG%" 2>&1
if not exist "node_modules\@md\editor-core\package.json" (
  echo   [!] 워크스페이스 링크가 없습니다. node_modules 를 다시 만듭니다...
  >> "%LOG%" echo --- node_modules 재설치 ---
  if exist node_modules rmdir /s /q node_modules
  call npm install >> "%LOG%" 2>&1
)
if not exist "node_modules\@md\editor-core\package.json" (
  echo.
  echo   [X] npm install 실패. 로그 마지막 30줄:
  echo ----------------------------------------
  powershell -NoProfile -Command "Get-Content -Tail 30 '%LOG%'"
  echo ----------------------------------------
  pause & exit /b 1
)
echo   [O] 준비 완료

echo.
echo 실행합니다. 첫 실행은 Rust 컴파일로 5~15분 걸립니다.
echo (이 창을 닫으면 앱도 종료됩니다)
echo.
call npm run sync-note
echo.
echo 종료되었습니다.
pause
