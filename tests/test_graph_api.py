"""星图数据接口：三层结构、节点与连线的一致性。"""


def test_empty_library_has_only_me(client):
    graph = client.get("/api/graph").json()
    assert [n["id"] for n in graph["nodes"]] == ["me"]
    assert graph["links"] == []


def test_graph_structure(client, make_entry):
    edu = make_entry(kind="education", title="XX大学 本科", org="XX大学", start="2022-09")
    proj = make_entry(kind="project", title="小程序", org="XX大学", start="2023-03", skills="Python")
    graph = client.get("/api/graph").json()
    ids = {n["id"] for n in graph["nodes"]}

    # 只为有条目的类型建分支节点
    assert {"me", "kind:education", "kind:project", f"entry:{edu}", f"entry:{proj}"} <= ids
    assert "kind:award" not in ids
    # 同一机构只有一个节点，连着两条经历
    org_links = [l for l in graph["links"] if l["target"] == "org:XX大学"]
    assert sorted(l["source"] for l in org_links) == [f"entry:{edu}", f"entry:{proj}"]
    # 所有连线两端都存在
    assert all(l["source"] in ids and l["target"] in ids for l in graph["links"])

    entry = next(n for n in graph["nodes"] if n["id"] == f"entry:{proj}")
    assert entry["year"] == 2023 and entry["skills"] == ["Python"] and entry["url"] == f"/entries/{proj}"
