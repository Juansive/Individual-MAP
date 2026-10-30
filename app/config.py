"""路径配置：所有数据都放在项目下的 data/ 目录里，拷走这个目录就是完整备份。"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
TEMPLATES_DIR = APP_DIR / "templates"
STATIC_DIR = APP_DIR / "static"

# 设置环境变量 IMAP_DATA_DIR 可以换一个数据目录（比如用测试数据试新功能，不碰真实数据）
DATA_DIR = Path(os.environ.get("IMAP_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "map.db"
VAULT_DIR = DATA_DIR / "vault"      # 证明文件归档目录（普通文件夹，脱离本软件也能直接浏览）
TRASH_DIR = DATA_DIR / "trash"      # 删除的文件先移到这里，不直接删掉
BACKUP_DIR = DATA_DIR / "backups"

HOST = "127.0.0.1"
PORT = 8765


def ensure_dirs() -> None:
    for d in (DATA_DIR, VAULT_DIR, TRASH_DIR, BACKUP_DIR):
        d.mkdir(parents=True, exist_ok=True)
