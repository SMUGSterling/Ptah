@echo off
rem Windows launcher: double-click to run the Ptah web build in your default browser.
rem Needs Node.js 20 or newer (https://nodejs.org). Leave this window open while you work.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Ptah needs Node.js 20 or newer. Install it from https://nodejs.org and double-click this file again.
  pause
  exit /b 1
)
node test\serve.mjs --open
