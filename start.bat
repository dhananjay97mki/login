@echo off
echo ========================================
echo         LOGIN SYSTEM STARTUP
echo ========================================
echo.

echo Killing any existing Node.js processes...
taskkill /F /IM node.exe 2>nul
if %errorlevel% equ 0 (
    echo ✓ Killed existing Node processes
) else (
    echo ✓ No existing Node processes found
)
echo.

echo Starting login system server...
echo ========================================
node server.js

pause
