@echo off
setlocal

set BINARY=%~dp0..\claudechrome-host.exe
set SHELL_ARG=powershell
if not "%1"=="" set SHELL_ARG=%1

if not exist "%BINARY%" (
    echo Error: %BINARY% not found
    echo Build the Go binary first: go build -o ..\claudechrome-host.exe .
    pause
    exit /b 1
)

echo Starting ClaudeChrome host: %SHELL_ARG%
start "" "%BINARY%" --shell %SHELL_ARG%
