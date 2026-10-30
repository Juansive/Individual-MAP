"""条目之间的关联。"""
from sqlmodel import Session, select

from app.db import engine
from app.models import EntryLink


def all_links():
    with Session(engine) as s:
        return s.exec(select(EntryLink)).all()


def test_link_shows_on_both_sides_and_in_graph(client, make_entry):
    project = make_entry(kind="project", title="垃圾分类识别")
    award = make_entry(kind="award", title="创新大赛二等奖")

    # 在奖项页面上说“这项成果来自…项目”
    resp = client.post(f"/entries/{award}/links", data={"relation": "produced:in", "target_id": project})
    assert "已关联「垃圾分类识别」" in resp.text

    [link] = all_links()
    assert (link.from_id, link.to_id, link.relation) == (project, award, "produced")
    assert "来自" in client.get(f"/entries/{award}").text
    assert "产出" in client.get(f"/entries/{project}").text

    graph = client.get("/api/graph").json()
    rel = [l for l in graph["links"] if l["type"] == "relation"]
    assert rel == [{"source": f"entry:{project}", "target": f"entry:{award}", "type": "relation",
                    "outLabel": "产出", "inLabel": "来自"}]


def test_self_and_duplicate_links_are_rejected(client, make_entry):
    a = make_entry(kind="project", title="A")
    b = make_entry(kind="award", title="B")

    assert "请选择另一条经历" in client.post(f"/entries/{a}/links", data={"relation": "related:out", "target_id": a}).text
    client.post(f"/entries/{a}/links", data={"relation": "produced:out", "target_id": b})
    resp = client.post(f"/entries/{b}/links", data={"relation": "related:out", "target_id": a})  # 反方向也算重复
    assert "已经和「A」关联过了" in resp.text
    assert len(all_links()) == 1


def test_unlink_and_delete_entry_removes_links(client, make_entry):
    a = make_entry(kind="education", title="本科")
    b = make_entry(kind="campus", title="社团")
    c = make_entry(kind="campus", title="学生会")
    client.post(f"/entries/{a}/links", data={"relation": "during:out", "target_id": b})
    client.post(f"/entries/{a}/links", data={"relation": "during:out", "target_id": c})

    first = all_links()[0]
    client.post(f"/links/{first.id}/delete", data={"next": f"/entries/{a}"})
    assert len(all_links()) == 1

    client.post(f"/entries/{a}/delete")
    assert all_links() == []
