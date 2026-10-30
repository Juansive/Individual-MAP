"""数据库升级。

SQLModel 的 create_all 只会创建不存在的表，不会给已有的表加字段。
以后要改表结构（比如给 Skill 加一个 color 字段），除了改 models.py，还要在 MIGRATIONS 末尾追加一个升级函数。
程序启动时会按顺序执行还没执行过的升级，执行到第几个记录在 SQLite 的 PRAGMA user_version 里。

写升级函数的约定：
- 只能往末尾追加，不要改动或删除已有的函数（用户的数据库可能已经执行过它们）
- 必须可以重复执行：新建的数据库也会把全部升级跑一遍，而 create_all 已经建好了最新的表结构，
  所以要用 add_column 这类“先检查再修改”的工具函数
- 升级前会自动做一份数据库快照；每个升级函数在一个事务里执行，出错会回滚

示例：
    def add_skill_color(conn):
        add_column(conn, "skill", "color", "VARCHAR NOT NULL DEFAULT ''")

    MIGRATIONS = [add_skill_color]
"""
import sqlite3
from collections.abc import Callable

from app import backup
from app.config import DB_PATH

Migration = Callable[[sqlite3.Connection], None]


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in conn.execute(f'PRAGMA table_info("{table}")'))


def add_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    """字段不存在才添加。ddl 是字段定义，比如 "VARCHAR NOT NULL DEFAULT ''"。"""
    if not column_exists(conn, table, column):
        conn.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}')


# 按顺序排列的升级函数。目前还没有需要升级的地方。
MIGRATIONS: list[Migration] = []


def schema_version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def migrate() -> list[str]:
    """执行还没执行过的升级，返回本次执行的升级函数名。"""
    # isolation_level=None：自己控制事务。Python 默认不会给 ALTER TABLE 这类语句开事务，出错就回滚不了
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    try:
        current = schema_version(conn)
        pending = MIGRATIONS[current:]
        if not pending:
            return []
        backup.auto_backup("before-upgrade")
        done = []
        for version, step in enumerate(pending, start=current + 1):
            conn.execute("BEGIN")  # 一个升级一个事务
            try:
                step(conn)
                conn.execute(f"PRAGMA user_version = {version}")
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            done.append(step.__name__)
        return done
    finally:
        conn.close()
