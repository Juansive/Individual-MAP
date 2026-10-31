"""大类的进化分支：掷骰子的权重、黑洞概率、路线选定后不再变化、接口字段。"""
import random

from sqlmodel import Session, select

from app.levels import (BLACK_HOLE_CHANCE, EVOLUTION_PATHS, black_hole_chance, kind_growth, path_weights,
                        roll_path)
from app.models import Entry, KindEvolution, Skill
from tests.test_levels import att


class FakeRng:
    """固定结果的随机数：random() 返回 r，choices 选第 pick 个，并记下收到的权重。"""

    def __init__(self, r, pick=0):
        self.r, self.pick, self.weights = r, pick, None

    def random(self):
        return self.r

    def choices(self, population, weights):
        self.weights = dict(zip(population, weights))
        return [population[self.pick]]


def test_names_follow_path_from_lv3():
    assert kind_growth("education", [5], "star").name == "日珥恒星"      # Lv5
    assert kind_growth("education", [5], "planet").name == "双环行星"
    assert kind_growth("education", [1], "star").name == "原恒星"        # Lv2 还没分叉，各路线一样
    assert kind_growth("education", [5, 5], "blackhole").name == "类星体"  # Lv8
    # Lv2 时提示快要分叉了
    assert kind_growth("project", [1, 1]).next_steps[-1] == "升到 Lv.3 时会分化出一条进化路线"


def test_path_weights_follow_the_data():
    e1 = Entry(kind="project", title="A", highlights="用户 800+\n完成开发\n提速 40%")
    e1.attachments = [att("a.png"), att("b.png")]
    e1.skills = [Skill(name="Python")]
    e2 = Entry(kind="project", title="B")
    e2.skills = [Skill(name="SQL"), Skill(name="Go")]
    # 恒星 = 1 + 带数字的成果 2 条；行星 = 1 + 文件 2 个；星云 = 1 + 技能 3 个 + 关联 1 条
    assert path_weights([e1, e2], relation_count=1) == {"star": 3, "planet": 3, "nebula": 5}
    assert path_weights([Entry(kind="other", title="空")], 0) == {"star": 1, "planet": 1, "nebula": 1}


def test_roll_path_black_hole_first_then_weighted():
    weights = {"star": 5, "planet": 1, "nebula": 2}
    assert roll_path(weights, FakeRng(BLACK_HOLE_CHANCE - 0.001)) == "blackhole"
    rng = FakeRng(BLACK_HOLE_CHANCE, pick=2)
    assert roll_path(weights, rng) == "nebula"
    assert rng.weights == weights                     # 常规路线按权重抽


def test_roll_path_frequencies():
    rng = random.Random(42)
    n = 20000
    results = [roll_path({"star": 3, "planet": 1, "nebula": 0}, rng) for _ in range(n)]
    assert abs(results.count("blackhole") / n - BLACK_HOLE_CHANCE) < 0.01
    assert abs(results.count("star") / n - (1 - BLACK_HOLE_CHANCE) * 0.75) < 0.015
    assert "nebula" not in results                    # 权重 0 的路线不会被抽中


def test_black_hole_chance_rises_until_pity():
    # 还没出过黑洞：15% → 25% → 35% → 45% → 第 5 次必出
    assert [round(black_hole_chance(m, False), 2) for m in range(5)] == [0.15, 0.25, 0.35, 0.45, 1.0]
    assert black_hole_chance(7, False) == 1.0                 # 旧规则下已经错过很多次，下次就必出
    assert black_hole_chance(3, True) == BLACK_HOLE_CHANCE    # 出过黑洞之后，保底不再累加
    assert roll_path({"star": 1}, FakeRng(0.999), chance=1.0) == "blackhole"


def test_fifth_fork_is_guaranteed_black_hole(client, make_entry, monkeypatch):
    # 5 个大类同时升到 Lv3：随机数永远不够小，前 4 个按权重走常规路线，第 5 个靠保底抽中黑洞
    for kind in ("education", "research", "volunteer"):         # 目标 2 条：一条 Lv2（2 点）= 20%
        make_entry(kind=kind, title=f"{kind}-1", start="2024-01", description="有描述")
    for kind in ("internship", "campus"):                       # 目标 3 条：Lv2 + Lv1（3 点）= 20%
        make_entry(kind=kind, title=f"{kind}-1", start="2024-01", description="有描述")
        make_entry(kind=kind, title=f"{kind}-2")
    monkeypatch.setattr("app.levels.random", FakeRng(0.99))
    graph = client.get("/api/graph").json()
    # 按 ENTRY_KINDS 的顺序分叉：education、internship、research、campus，第 5 个是 volunteer
    assert _paths() == {"education": "star", "internship": "star", "research": "star",
                        "campus": "star", "volunteer": "blackhole"}
    assert graph["evolution"] == {"blackHoleFound": True, "blackHoleChance": BLACK_HOLE_CHANCE, "pityLeft": 0}


def test_graph_reports_pity_progress(client, make_entry, monkeypatch):
    graph = client.get("/api/graph").json()
    assert graph["evolution"] == {"blackHoleFound": False, "blackHoleChance": 0.15, "pityLeft": 5}
    make_entry(kind="education", title="本科", start="2021-09", description="计算机")
    monkeypatch.setattr("app.levels.random", FakeRng(0.99))
    graph = client.get("/api/graph").json()                     # 第 1 次分叉没中
    assert graph["evolution"]["pityLeft"] == 4 and round(graph["evolution"]["blackHoleChance"], 2) == 0.25


def _paths():
    from app.db import engine
    with Session(engine) as s:
        return {row.kind: row.path for row in s.exec(select(KindEvolution)).all()}


def test_path_is_rolled_once_at_lv3_and_never_changes(client, make_entry, monkeypatch):
    make_entry(kind="project", title="P0")
    graph = client.get("/api/graph").json()
    project = next(n for n in graph["nodes"] if n["id"] == "kind:project")
    assert project["growth"] == 1 and project["path"] == "" and _paths() == {}   # Lv1：还没分叉

    for i in range(1, 4):
        make_entry(kind="project", title=f"P{i}")                               # 4 条 Lv1 → 4/20 = 20% → Lv3
    monkeypatch.setattr("app.levels.random", FakeRng(0.9, pick=1))              # 抽到第二条：行星之路
    project = next(n for n in client.get("/api/graph").json()["nodes"] if n["id"] == "kind:project")
    assert (project["growth"], project["path"], project["pathName"], project["pathIcon"]) == (3, "planet", "行星之路", "🪐")
    assert project["growthName"] == EVOLUTION_PATHS["planet"].stage_names[0]
    assert _paths() == {"project": "planet"}

    # 之后不管怎么掷骰子、数据怎么变，路线都不变
    monkeypatch.setattr("app.levels.random", FakeRng(0.0))                      # 这次会抽到黑洞
    make_entry(kind="project", title="P4", start="2024-01", description="新经历", skills="Python")
    project = next(n for n in client.get("/api/graph").json()["nodes"] if n["id"] == "kind:project")
    assert project["path"] == "planet" and _paths() == {"project": "planet"}


def test_graph_lists_all_paths(client):
    paths = client.get("/api/graph").json()["levels"]["paths"]
    assert [p["key"] for p in paths] == ["star", "planet", "nebula", "blackhole"]
    assert paths[0] == {"key": "star", "name": "恒星之路", "icon": "☀️"}
