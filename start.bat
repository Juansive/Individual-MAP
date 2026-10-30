@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo 首次运行，正在创建 Python 虚拟环境...
    python -m venv .venv || goto :error
)

".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || goto :error
".venv\Scripts\python.exe" run.py
goto :eof

:error
echo.
echo 启动失败，请检查上面的错误信息。
pause
