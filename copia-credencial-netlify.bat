@echo off
REM ============================================================
REM  copia-credencial-netlify.bat - Encontre Pet
REM  Copia o serviceAccountKey.json em BASE64 para a area de
REM  transferencia, pronto para colar no painel Netlify como
REM  valor da env var FIREBASE_SERVICE_ACCOUNT.
REM ============================================================
cd /d "%~dp0"
powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('scripts\serviceAccountKey.json')) | Set-Clipboard"
if errorlevel 1 (
  echo ERRO: nao consegui ler scripts\serviceAccountKey.json
) else (
  echo Pronto! O base64 da credencial esta na area de transferencia.
  echo Cole no painel Netlify: Site settings ^> Environment variables
  echo   Key:   FIREBASE_SERVICE_ACCOUNT
  echo   Value: ^(Ctrl+V^)
)
pause
