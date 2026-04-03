@echo off
cd /d "%~dp0"

echo.
echo ================================
echo   Deploy to GitHub Pages
echo ================================
echo.

echo [git status]
git status --short
echo.

git add -A

git diff --cached --quiet
if %errorlevel% EQU 0 (
    echo No changes to deploy.
    goto END
)

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /format:list') do set DT=%%I
set MSG=update %DT:~0,4%-%DT:~4,2%-%DT:~6,2% %DT:~8,2%:%DT:~10,2%

git commit -m "%MSG%"
if %errorlevel% NEQ 0 (
    echo Commit failed.
    goto END
)

echo.
echo Pushing to GitHub...
git push origin main
if %errorlevel% NEQ 0 (
    echo Push failed. Check your network or GitHub login.
    goto END
)

echo.
echo ================================
echo   Done!
echo   https://k94love.github.io/travel/
echo ================================

:END
echo.
pause
