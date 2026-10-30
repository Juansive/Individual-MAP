"""证明文件：归档命名、去重、待归类、删除。"""
from sqlmodel import Session, select

from app import config
from app.db import engine
from app.models import Attachment
from tests.conftest import png


def attachments():
    with Session(engine) as s:
        return s.exec(select(Attachment)).all()


def test_quick_add_archives_file_by_year_and_kind(client):
    resp = client.post("/entries/quick",
                       data={"kind": "award", "title": "国家奖学金", "start": "2024-10"},
                       files=[("files", ("证书.png", png(b"a"), "image/png"))])
    assert "已记录「国家奖学金」" in resp.text

    [att] = attachments()
    assert att.stored_path == "2024/奖项荣誉/2024-10_国家奖学金_证书.png"
    assert (config.VAULT_DIR / att.stored_path).read_bytes() == png(b"a")


def test_same_file_is_stored_once(client, make_entry):
    entry_id = make_entry(kind="project", title="项目A", start="2023-01")
    client.post(f"/entries/{entry_id}/files", files=[("files", ("a.png", png(b"x"), "image/png"))])
    resp = client.post(f"/entries/{entry_id}/files", files=[("files", ("a-副本.png", png(b"x"), "image/png"))])

    assert "之前已存过" in resp.text
    assert len(attachments()) == 1


def test_inbox_file_moves_to_entry_when_uploaded_again(client, make_entry):
    client.post("/inbox/upload", files=[("files", ("扫描件.png", png(b"s"), "image/png"))])
    [att] = attachments()
    assert att.entry_id is None and att.stored_path.startswith("_待归类/")

    entry_id = make_entry(kind="competition", title="数学建模", start="2024-09")
    resp = client.post(f"/entries/{entry_id}/files", files=[("files", ("扫描件.png", png(b"s"), "image/png"))])

    assert "从待归类移入" in resp.text
    [att] = attachments()
    assert att.entry_id == entry_id
    assert att.stored_path.startswith("2024/竞赛/")
    assert not any((config.VAULT_DIR / "_待归类").iterdir())


def test_deleting_entry_returns_files_to_inbox(client, make_entry):
    entry_id = make_entry(kind="award", title="三好学生", start="2022-12",
                          files=[("files", ("奖状.png", png(b"d"), "image/png"))])
    client.post(f"/entries/{entry_id}/delete")

    [att] = attachments()
    assert att.entry_id is None
    assert (config.VAULT_DIR / att.stored_path).exists()


def test_editing_entry_moves_its_files(client, make_entry):
    entry_id = make_entry(kind="project", title="旧标题", start="2023-01",
                          files=[("files", ("截图.png", png(b"e"), "image/png"))])
    resp = client.post(f"/entries/{entry_id}/edit",
                       data={"kind": "award", "title": "新标题", "start": "2024-05"})

    assert "1 个文件已按新信息重新整理" in resp.text
    [att] = attachments()
    assert att.stored_path == "2024/奖项荣誉/2024-05_新标题_截图.png"
    assert (config.VAULT_DIR / att.stored_path).exists()
    assert not (config.VAULT_DIR / "2023").exists()       # 留下的空文件夹被清理


def test_organize_all_fixes_old_paths_and_is_idempotent(client, make_entry):
    make_entry(kind="award", title="奖学金", start="2023-11", files=[("files", ("证书.png", png(b"o"), "image/png"))])
    # 模拟以前用别的规则存的文件
    [att] = attachments()
    old = config.VAULT_DIR / "旧文件夹" / "随便.png"
    old.parent.mkdir()
    (config.VAULT_DIR / att.stored_path).rename(old)
    with Session(engine) as s:
        a = s.get(Attachment, att.id)
        a.stored_path = "旧文件夹/随便.png"
        s.add(a)
        s.commit()

    assert "移动了 1 个文件" in client.post("/vault/organize").text
    assert "所有文件都已经整理好了" in client.post("/vault/organize").text
    [att] = attachments()
    assert att.stored_path == "2023/奖项荣誉/2023-11_奖学金_证书.png"
    assert not (config.VAULT_DIR / "旧文件夹").exists()


def test_removing_file_moves_it_to_trash(client, make_entry):
    entry_id = make_entry(kind="award", title="三好学生", files=[("files", ("奖状.png", png(b"t"), "image/png"))])
    [att] = attachments()
    client.post(f"/files/{att.id}/delete", data={"next": f"/entries/{entry_id}"})

    assert attachments() == []
    trashed = list(config.TRASH_DIR.iterdir())
    assert len(trashed) == 1 and trashed[0].read_bytes() == png(b"t")
