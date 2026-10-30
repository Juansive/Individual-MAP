"""自动备份与数据库升级。"""
import sqlite3
from contextlib import closing

import pytest

from app import backup, config, migrations


def db():
    return closing(sqlite3.connect(config.DB_PATH, isolation_level=None))


def reset_version():
    with db() as conn:
        conn.execute("PRAGMA user_version = 0")


def test_startup_snapshot_only_when_data_changed(client, make_entry):
    before = len(backup.auto_snapshots())
    assert backup.auto_backup("startup") is None          # 没有改动，不重复备份

    make_entry(kind="award", title="新奖项")
    assert backup.auto_backup("startup") is not None      # 有改动，备份
    assert len(backup.auto_snapshots()) == before + 1


def test_keeps_only_latest_snapshots(client):
    for i in range(backup.KEEP_AUTO + 3):
        backup.auto_backup(f"test{i:02d}")
    snaps = backup.auto_snapshots()
    assert len(snaps) == backup.KEEP_AUTO
    assert snaps[-1].name.endswith(f"test{backup.KEEP_AUTO + 2:02d}.db")


def test_migration_adds_column_once_and_backs_up(client, monkeypatch):
    def add_skill_color(conn):
        migrations.add_column(conn, "skill", "color", "VARCHAR NOT NULL DEFAULT ''")

    monkeypatch.setattr(migrations, "MIGRATIONS", [add_skill_color])
    reset_version()

    assert migrations.migrate() == ["add_skill_color"]
    assert migrations.migrate() == []                     # 第二次什么都不做
    with db() as conn:
        assert migrations.column_exists(conn, "skill", "color")
        assert migrations.schema_version(conn) == 1
    assert any("before-upgrade" in p.name for p in backup.auto_snapshots())


def test_failed_migration_rolls_back(client, monkeypatch):
    def broken(conn):
        migrations.add_column(conn, "skill", "temp", "VARCHAR")
        raise RuntimeError("故意出错")

    monkeypatch.setattr(migrations, "MIGRATIONS", [broken])
    reset_version()

    with pytest.raises(RuntimeError):
        migrations.migrate()
    with db() as conn:
        assert not migrations.column_exists(conn, "skill", "temp")
        assert migrations.schema_version(conn) == 0
