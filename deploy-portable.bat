@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

set "LOG=%~dp0deploy-log.txt"
title portable 실행 파일 배포

:check_build
if not exist "release-out\MD-Editor-portable.exe" (
  echo ============================================
  echo   빌드된 파일을 찾지 못했습니다.
  echo   먼저 build-portable.bat 을 실행하여 빌드를 완료하세요.
  echo ============================================
  pause
  exit /b 1
)

if not exist "release-out\MDSyncNote-portable.exe" (
  echo ============================================
  echo   MDSyncNote portable 파일을 찾지 못했습니다.
  echo   먼저 build-portable.bat 을 실행하여 빌드를 완료하세요.
  echo ============================================
  pause
  exit /b 1
)

echo ============================================
echo     portable 실행 파일 배포 (C:\utility\Markdown\)
echo ============================================
echo.

> "%LOG%" echo === %DATE% %TIME% ===

set "DEST=C:\utility\Markdown\"
if not exist "%DEST%" mkdir "%DEST%"

echo [1/2] MD-Editor portable 복사...
copy /y "release-out\MD-Editor-portable.exe" "%DEST%\MD-Editor-portable.exe" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] MD-Editor 복사 실패
  pause
  exit /b 1
)

echo [2/2] MDSyncNote portable 복사...
copy /y "release-out\MDSyncNote-portable.exe" "%DEST%\MDSyncNote-portable.exe" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   [X] MDSyncNote 복사 실패
  pause
  exit /b 1
)

echo.
echo ============================================
echo     배포 완료!
echo ============================================
echo     위치: %DEST%
echo ============================================
dir "%DEST%" /b >> "%LOG%"
explorer "%DEST%"

pause
