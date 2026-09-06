@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title portable 실행 파일 배포

rem 빌드해 둔 portable exe 두 개를 실제로 쓰는 자리에 복사한다.
rem **빌드는 하지 않는다** — 먼저 build-portable.bat (또는 build-all.bat) 을 돌릴 것.
rem
rem 목적지는 인자로 바꿀 수 있다.
rem   deploy.bat                      →  C:\utility\Markdown
rem   deploy.bat D:\tools\Markdown    →  그쪽으로

set "DEST=%~1"
if "%DEST%"=="" set "DEST=C:\utility\Markdown"

rem target\release 가 진짜 빌드 결과다. release-out 은 빌드 배치가 만든 복사본이므로
rem target 을 지웠을 때를 대비한 대비책으로만 쓴다.
set "SRC=%~dp0target\release"
set "A=md-editor.exe"
set "B=md-sync-note.exe"
if not exist "%SRC%\%A%" (
  set "SRC=%~dp0release-out"
  set "A=MD-Editor-portable.exe"
  set "B=MDSyncNote-portable.exe"
)

echo ============================================
echo   portable 실행 파일 배포
echo ============================================
echo   원본: %SRC%
echo   대상: %DEST%
echo.

echo [1/4] 빌드 결과 확인...
set "MISSING="
if not exist "%SRC%\%A%" set "MISSING=1"
if not exist "%SRC%\%B%" set "MISSING=1"
if defined MISSING (
  echo   [X] 빌드된 exe 가 없습니다.
  echo       build-portable.bat 을 먼저 돌리세요. ^(처음이면 Rust 컴파일로 5~15분^)
  echo.
  pause & exit /b 1
)
for %%f in ("%SRC%\%A%" "%SRC%\%B%") do echo   [O] %%~nxf   %%~zf bytes   %%~tf

echo [2/4] 앱이 켜져 있는지 확인...
rem 실행 중인 exe 는 덮어쓸 수 없다. 복사가 반쯤 되고 실패하기 전에 미리 막는다.
set "RUNNING="
for %%p in (MD-Editor-portable.exe MDSyncNote-portable.exe md-editor.exe md-sync-note.exe) do (
  tasklist /fi "imagename eq %%p" 2>nul | find /i "%%p" >nul && (
    echo   [!] %%p 이^(가^) 실행 중입니다
    set "RUNNING=1"
  )
)
if defined RUNNING (
  echo       창을 모두 닫고 다시 실행하세요.
  echo.
  pause & exit /b 1
)
echo   [O] 켜져 있는 것 없음

echo [3/4] 대상 폴더 준비...
if not exist "%DEST%" (
  mkdir "%DEST%"
  if errorlevel 1 ( echo   [X] 폴더를 만들 수 없습니다: %DEST% & pause & exit /b 1 )
  echo   [O] 폴더를 새로 만들었습니다
) else (
  echo   [O] 이미 있습니다 ^(같은 이름은 덮어씁니다^)
)

echo [4/4] 복사...
copy /y "%SRC%\%A%" "%DEST%\MD-Editor-portable.exe"  >nul
if errorlevel 1 ( echo   [X] MD Editor 복사 실패 & pause & exit /b 1 )
copy /y "%SRC%\%B%" "%DEST%\MDSyncNote-portable.exe" >nul
if errorlevel 1 ( echo   [X] MDSyncNote 복사 실패 & pause & exit /b 1 )

echo.
echo ============================================
echo   완료: %DEST%
echo ============================================
for %%f in ("%DEST%\MD-Editor-portable.exe" "%DEST%\MDSyncNote-portable.exe") do (
  for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Item '%%~f').VersionInfo.FileVersion" 2^>nul') do (
    echo   %%~nxf   v%%v   %%~zf bytes
  )
)
echo.
explorer "%DEST%"
pause
