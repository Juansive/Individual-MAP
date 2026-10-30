"""备份。

- 数据库快照：启动时、升级数据库前自动做，存到 data/backups/auto/，只保留最近 KEEP_AUTO 份。
  证明文件不会被程序真正删除（只会移到 data/trash/），所以自动快照只备份数据库，又小又快。
- 完整备份：数据库 + 全部证明文件打成 zip，在“导出与备份”页手动生成。

恢复数据库快照：先关掉程序，把快照复制成 data/map.db，再启动。
"""
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.config import BACKUP_DIR, DB_PATH, VAULT_DIR

AUTO_DIR = BACKUP_DIR / "auto"
KEEP_AUTO = 10


def snapshot_db(dest: Path) -> None:
    """用 SQLite 自带的 backup 接口复制数据库，避免复制到写了一半的文件。"""
    src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()


def auto_snapshots() -> list[Path]:
    """按时间从旧到新排列（文件名以时间开头）。"""
    return sorted(AUTO_DIR.glob("map_*.db"))


def auto_backup(reason: str = "startup") -> Optional[Path]:
    """做一份数据库快照；返回快照路径，没做则返回 None。"""
    if not DB_PATH.exists() or DB_PATH.stat().st_size == 0:
        return None
    AUTO_DIR.mkdir(parents=True, exist_ok=True)

    existing = auto_snapshots()
    # 启动时：上次快照之后数据库没改过，就不重复备份。这样频繁重启也不会把旧快照挤掉
    if reason == "startup" and existing and existing[-1].stat().st_mtime >= DB_PATH.stat().st_mtime:
        return None

    dest = AUTO_DIR / f"map_{datetime.now():%Y%m%d_%H%M%S_%f}_{reason}.db"
    snapshot_db(dest)
    for old in auto_snapshots()[:-KEEP_AUTO]:
        old.unlink()
    return dest


def full_backup() -> Path:
    """数据库 + 全部证明文件打成一个 zip，存在 data/backups/ 下。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = BACKUP_DIR / f"backup_{datetime.now():%Y%m%d_%H%M%S}.zip"
    with tempfile.TemporaryDirectory() as tmp:
        db_copy = Path(tmp) / "map.db"
        snapshot_db(db_copy)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(db_copy, "map.db")
            for path in VAULT_DIR.rglob("*"):
                if path.is_file():
                    zf.write(path, Path("vault") / path.relative_to(VAULT_DIR))
    return zip_path
