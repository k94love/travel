@echo off
cd /d "%~dp0"

echo.
echo ================================
echo   Deploy Firestore Rules
echo ================================
echo.

echo [Current firestore.rules content]
echo --------------------------------
type firestore.rules
echo.
echo --------------------------------
echo.

firebase deploy --only firestore:rules

if %errorlevel% EQU 0 (
    echo.
    echo ================================
    echo   Success! Rules deployed.
    echo   Project: trip-a4f93
    echo ================================
) else (
    echo.
    echo ================================
    echo   Failed! Please check:
    echo   1. Firebase CLI is installed
    echo      ^> npm install -g firebase-tools
    echo   2. You are logged in
    echo      ^> firebase login
    echo   3. Project config is correct (.firebaserc)
    echo ================================
)

echo.
pause
