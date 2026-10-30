"""页面能打开、搜索筛选、技能合并、导出。"""
import io
import zipfile

from tests.conftest import png


def test_all_pages_render(client, make_entry):
    entry_id = make_entry(kind="internship", title="数据分析实习", org="某公司", start="2025-07")
    for url in ["/", "/?view=list", "/?todo=1", "/inbox", "/export", "/graph",
                f"/entries/{entry_id}", f"/entries/{entry_id}/edit", "/entries/new"]:
        assert client.get(url).status_code == 200, url


def test_skill_names_are_merged_case_insensitively(client, make_entry):
    make_entry(kind="project", title="A", skills="Python、SQL")
    make_entry(kind="project", title="B", skills="python, 机器学习")
    graph = client.get("/api/graph").json()
    skills = sorted(n["label"] for n in graph["nodes"] if n["type"] == "skill")
    assert skills == ["Python", "SQL", "机器学习"]


def test_search_and_filters(client, make_entry):
    make_entry(kind="project", title="垃圾分类识别", skills="PyTorch", start="2024-03")
    make_entry(kind="award", title="国家奖学金", start="2023-11")

    def titles(query):
        return [t for t in ("垃圾分类识别", "国家奖学金") if t in client.get(f"/?view=list&{query}").text]

    assert titles("q=pytorch") == ["垃圾分类识别"]       # 技能也能搜到，且不分大小写
    assert titles("kind=award") == ["国家奖学金"]
    assert titles("year=2024") == ["垃圾分类识别"]
    assert titles("skill=PyTorch") == ["垃圾分类识别"]


def test_markdown_export_and_full_backup(client, make_entry):
    make_entry(kind="award", title="国家奖学金", start="2023-11", highlights="专业前 5%",
               files=[("files", ("证书.png", png(b"z"), "image/png"))])

    md = client.get("/export/markdown").text
    assert "## 奖项荣誉" in md and "### 国家奖学金" in md and "- 专业前 5%" in md

    resp = client.get("/export/backup")
    names = zipfile.ZipFile(io.BytesIO(resp.content)).namelist()
    assert "map.db" in names
    assert any(n.startswith("vault/2023/") for n in names)
