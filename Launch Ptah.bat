@echo off
setlocal enabledelayedexpansion
rem Windows launcher: double-click to run the Ptah web build in your default browser.
rem Needs Node.js 22 or newer (https://nodejs.org). Leave this window open while you work.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Ptah needs Node.js 22 or newer. Install it from https://nodejs.org and double-click this file again.
  pause
  exit /b 1
)
set "NODE_MAJOR="
for /f %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
  echo Ptah needs Node.js 22 or newer. Install it from https://nodejs.org and double-click this file again.
  pause
  exit /b 1
)
if !NODE_MAJOR! LSS 22 (
  set "NODE_VERSION="
  for /f %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%v"
  if not defined NODE_VERSION set "NODE_VERSION=an unsupported version"
  echo Ptah needs Node.js 22 or newer. You have Node.js !NODE_VERSION!. Install a newer Node.js from https://nodejs.org and double-click this file again.
  pause
  exit /b 1
)
node test\serve.mjs --open
