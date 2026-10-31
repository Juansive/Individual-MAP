"""成长等级与星图里的等级字段。"""
from app.levels import entry_growth, kind_growth, satellites
from app.models import Attachment, Entry, Skill


def att(name="证书.png"):
    return Attachment(original_name=name, stored_path="x", sha256=name)


def test_levels_climb_step_by_step():
    e = Entry(kind="award", title="国家奖学金")
    g = entry_growth(e)
    assert (g.level, g.name, g.next_steps) == (1, "星尘", ["填写时间", "写几句描述"])

    e.start, e.description = "2023-11", "专业前 5%"
    assert entry_growth(e).level == 2
    assert entry_growth(e).next_steps == ["上传一个证明文件，或写一条成果要点"]

    e.attachments = [att()]
    g = entry_growth(e)
    assert (g.level, g.next_steps) == (3, ["补全：缺机构"])

    e.org = "XX大学"
    g = entry_growth(e)
    assert (g.level, g.name) == (4, "光晕行星")
    assert g.next_steps == ["再写 2 条带数字的成果", "再加 2 个技能标签（或者级别是国家级/国际级）"]

    e.level = "国家级"
    g = entry_growth(e)
    assert (g.level, g.name, g.next_steps, g.progress) == (5, "闪耀行星", [], 1.0)


def test_star_by_numbers_and_skills():
    e = Entry(kind="project", title="小程序", org="XX大学", start="2023-03", description="课程设计",
              highlights="上线两周注册 800+ 用户\n完成前后端开发")
    e.skills = [Skill(name="Python"), Skill(name="微信小程序")]
    g = entry_growth(e)
    assert (g.level, g.next_steps) == (4, ["再写 1 条带数字的成果"])   # 项目没有“级别”，不提示

    e.highlights += "\n响应时间降低 40%"
    assert entry_growth(e).level == 5


def test_kind_growth_has_eight_front_loaded_levels():
    # 门槛 0/10/20/35/50/65/80/100%。教育目标 2 条（满级 10 点）
    assert [kind_growth("education", [p]).level for p in (1, 2, 3, 4, 5)] == [2, 3, 3, 4, 5]
    g = kind_growth("education", [5])                       # 5/10 = 50%
    assert (g.level, g.name, g.progress, g.need) == (5, "双环恒星", 0.5, 2)
    assert g.next_steps == ["再攒 2 点成长值升到 Lv.6（每条经历按等级计 1~5 点，新增或补全经历都算）"]
    g = kind_growth("education", [5, 5])                    # 100%
    assert (g.level, g.name, g.need, g.next_steps) == (8, "璀璨星系", 0, [])


def test_kind_growth_counts_quantity_and_quality():
    assert kind_growth("award", [4] * 6).level == 7          # 24/30 = 80% → 旋涡星系
    assert kind_growth("award", [3] * 12).level == 8         # 36/30，封顶 100%：条数多也能弥补质量
    assert kind_growth("project", [1]).level == 1            # 1/20 = 5%：刚起步
    assert kind_growth("project", [1, 1]).level == 2         # 2/20 = 10%：很快就能升第一级


def test_satellites_are_files_then_highlights_capped():
    e = Entry(kind="project", title="A", highlights="\n".join(f"成果{i}" for i in range(8)))
    e.attachments = [att("a.pdf")]
    sats = satellites(e)
    assert len(sats) == 6
    assert sats[0] == {"type": "file", "label": "a.pdf"}
    assert sats[1] == {"type": "highlight", "label": "成果0"}


def test_graph_api_carries_growth(client, make_entry):
    make_entry(kind="other", title="随手记")
    make_entry(kind="other", title="完整的", start="2024-01", highlights="完成 3 件事")
    for i in range(4):
        make_entry(kind="project", title=f"P{i}", skills="Python")

    graph = client.get("/api/graph").json()
    assert [l["name"] for l in graph["levels"]["kind"]][-1] == "璀璨星系" and len(graph["levels"]["kind"]) == 8
    assert len(graph["levels"]["entry"]) == 5
    nodes = {n["label"]: n for n in graph["nodes"]}
    assert nodes["随手记"]["growth"] == 1 and nodes["随手记"]["satellites"] == []
    assert nodes["完整的"]["growth"] == 4 and nodes["完整的"]["growthName"] == "光晕行星"
    assert nodes["完整的"]["satellites"] == [{"type": "highlight", "label": "完成 3 件事"}]
    assert nodes["Python"]["star"] is True          # 4 条经历用到，成为核心技能

    # 大类等级由下面的经历累积：项目 4 条都只有标题（各 Lv1），4/20 = 20% → Lv3
    project = nodes["项目经历"]
    assert (project["growth"], project["count"], project["need"]) == (3, 4, 3)
    other = nodes["其他"]                             # 1 条 Lv1 + 1 条 Lv4 = 5/15 = 33%
    assert (other["growth"], round(other["progress"], 2)) == (3, 0.33)
    assert other["size"] == 5 + 3                     # 等级越高球越大
