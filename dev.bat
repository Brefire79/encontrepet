@echo off
REM ============================================================
REM  dev.bat - Encontre Pet: instala deps e sobe o ambiente local
REM  (site + Netlify Functions em http://localhost:8888)
REM  Uso: duplo clique ou "dev.bat" no terminal, na raiz do projeto
REM ============================================================
cd /d "%~dp0"

if not exist node_modules (
  echo [dev] Instalando dependencias ^(primeira vez demora alguns minutos^)...
  call npm install
  if errorlevel 1 (
    echo [dev] ERRO no npm install. Verifique o Node/npm e tente de novo.
    pause
    exit /b 1
  )
)

echo.
echo [dev] Subindo netlify dev em http://localhost:8888 ...
echo [dev] Credencial local: .env aponta para scripts\serviceAccountKey.json
echo [dev] Ctrl+C para encerrar.
echo.
call npx netlify dev
pause
