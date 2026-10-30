"""启动入口：python run.py，启动后自动打开浏览器。"""
import threading
import webbrowser

import uvicorn

from app.config import HOST, PORT

if __name__ == "__main__":
    url = f"http://{HOST}:{PORT}"
    print(f"Individual Map 已启动：{url}  （关闭此窗口即可退出）")
    threading.Timer(1.5, webbrowser.open, args=[url]).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="warning")
