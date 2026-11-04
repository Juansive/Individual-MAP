"""代表作：设置与取消、数量上限、筛选、导出排序、星图字段。"""
from sqlmodel import Session

from app.models import FEATURED_MAX, Entry


def entry(entry_id: int) -> Entry:
    from app.db import engine
    with Session(engine) as s:
        return s.get(Entry, entry_id)


def test_toggle_featured_and_default_style(client, make_entry):
    proj = make_entry(kind="project", title="校园二手平台")
    award = make_entry(kind="award", title="国家奖学金")

    resp = client.post(f"/entries/{proj}/feature")
    assert "设为代表作" in resp.text
    assert (entry(proj).featured, entry(proj).featured_style) == (True, "spotlight")  # 项目默认聚光灯
    client.post(f"/entries/{award}/feature")
    assert entry(award).featured_style == "crown"                                    # 奖项默认星冠

    client.post(f"/entries/{proj}/feature")                                          # 再点一次取消
    assert entry(proj).featured is False and entry(proj).featured_style == "spotlight"  # 特效记着，下次沿用


def test_featured_is_limited(client, make_entry):
    ids = [make_entry(kind="award", title=f"奖{i}") for i in range(FEATURED_MAX + 1)]
    for i in ids[:FEATURED_MAX]:
        client.post(f"/entries/{i}/feature")
    resp = client.post(f"/entries/{ids[-1]}/feature")
    assert f"代表作最多 {FEATURED_MAX} 条" in resp.text
    assert entry(ids[-1]).featured is False


def test_index_filter_and_export_order(client, make_entry):
    make_entry(kind="project", title="普通项目", start="2024-01")
    star = make_entry(kind="project", title="得意项目", start="2022-01")
    client.post(f"/entries/{star}/feature")

    page = client.get("/?featured=1").text
    assert "得意项目" in page and "普通项目" not in page

    md = client.get("/export/markdown").text
    assert "代表作：得意项目" in md
    assert md.index("### 🏅 得意项目") < md.index("### 普通项目")   # 同类型里代表作排前面，即使时间更早


def test_graph_marks_featured(client, make_entry):
    star = make_entry(kind="competition", title="建模竞赛")
    plain = make_entry(kind="competition", title="程序设计赛")
    client.post(f"/entries/{star}/feature")
    graph = client.get("/api/graph").json()
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert (nodes[f"entry:{star}"]["featured"], nodes[f"entry:{star}"]["featuredStyle"]) == (True, "crown")
    assert (nodes[f"entry:{plain}"]["featured"], nodes[f"entry:{plain}"]["featuredStyle"]) == (False, "")
    featured_links = [l for l in graph["links"] if l["type"] == "featured"]
    assert featured_links == [{"source": "me", "target": f"entry:{star}", "type": "featured"}]
