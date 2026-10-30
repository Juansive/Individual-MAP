"""技能管理：类别、重命名、合并、删除。"""
from sqlmodel import Session, select

from app.db import engine
from app.models import Entry, Skill


def skills():
    with Session(engine) as s:
        return {sk.name: sorted(e.title for e in sk.entries) for sk in s.exec(select(Skill)).all()}


def skill_id(name):
    with Session(engine) as s:
        return s.exec(select(Skill).where(Skill.name == name)).one().id


def test_category_and_rename_show_in_graph(client, make_entry):
    make_entry(kind="project", title="A", skills="py")
    client.post(f"/skills/{skill_id('py')}/update", data={"name": "Python", "category": "tech"})

    [node] = [n for n in client.get("/api/graph").json()["nodes"] if n["type"] == "skill"]
    assert (node["label"], node["category"], node["categoryLabel"]) == ("Python", "tech", "技术")
    assert client.get("/skills").status_code == 200


def test_merge_moves_entries_without_duplicates(client, make_entry):
    make_entry(kind="project", title="A", skills="ML")
    make_entry(kind="project", title="B", skills="ML、机器学习")
    make_entry(kind="project", title="C", skills="机器学习")

    resp = client.post(f"/skills/{skill_id('ML')}/merge", data={"target_id": skill_id("机器学习")})
    assert "转移了 1 条经历" in resp.text      # B 本来就有“机器学习”，不重复添加
    assert skills() == {"机器学习": ["A", "B", "C"]}


def test_rename_to_existing_name_merges(client, make_entry):
    make_entry(kind="project", title="A", skills="SQL")
    make_entry(kind="project", title="B", skills="MySQL")

    resp = client.post(f"/skills/{skill_id('MySQL')}/update", data={"name": "sql", "category": ""})
    assert "已把「MySQL」合并过去" in resp.text
    assert skills() == {"SQL": ["A", "B"]}


def test_delete_skill_keeps_entries(client, make_entry):
    make_entry(kind="project", title="A", skills="Excel")
    client.post(f"/skills/{skill_id('Excel')}/delete")

    assert skills() == {}
    with Session(engine) as s:
        assert [e.title for e in s.exec(select(Entry)).all()] == ["A"]
