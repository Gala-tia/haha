@echo off
setlocal
rem Use the Node runtime bundled with WorkBuddy; no global install required.
set "NODE_DIR=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6"
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
echo ============================================
echo   Collaborative Document Platform
echo   Open http://localhost:3000/admin.html
echo   Press Ctrl+C to stop the server
echo ============================================
echo.
call npm start
echo.
echo Server stopped. Press any key to close this window.
pause >nul
