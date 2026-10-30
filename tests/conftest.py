"""测试公共设置。

测试一律使用临时数据目录，绝不碰 data/ 里的真实数据：
IMAP_DATA_DIR 必须在导入 app 之前设置好，所以放在这个文件最上面。
"""
import os
import shutil
import tempfile
from pathlib import Path

_TEST_DATA = Path(tempfile.mkdtemp(prefix="imap-test-"))
os.environ["IMAP_DATA_DIR"] = str(_TEST_DATA)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app import config  # noqa: E402

# 再确认一次：数据目录必须是临时目录
assert config.DATA_DIR == _TEST_DATA, "测试没有使用临时数据目录，停止运行以保护真实数据"


@pytest.fixture
def client():
    """每个测试都从一个空的素材库开始。"""
    from app.db import engine
    from app.main import app

    engine.dispose()
    for d in (config.VAULT_DIR, config.TRASH_DIR, config.BACKUP_DIR):
        shutil.rmtree(d, ignore_errors=True)
    if config.DB_PATH.exists():
        config.DB_PATH.unlink()
    config.ensure_dirs()
    SQLModel.metadata.create_all(engine)

    with TestClient(app) as c:  # 会触发 lifespan：自动备份 + 建表 + 升级
        yield c
    engine.dispose()


def add_entry(client, **fields) -> int:
    """通过“新建条目”表单造一条数据，返回新条目的 id。"""
    files = fields.pop("files", None)
    resp = client.post("/entries/new", data=fields, files=files)
    assert resp.status_code == 200
    return int(str(resp.url).split("/entries/")[1].split("?")[0])


@pytest.fixture
def make_entry(client):
    return lambda **fields: add_entry(client, **fields)


def png(tag: bytes = b"") -> bytes:
    """一个假的 PNG 文件内容，tag 不同内容就不同。"""
    return b"\x89PNG\r\n\x1a\n" + tag
