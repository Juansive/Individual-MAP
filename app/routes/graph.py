"""星图：把素材库变成 3D 神经网络。

节点分四种，连成三层结构，保证数据再少也是一张连通的网：
    我（中心） → 类型分支 → 条目 ↔ 技能 / 机构
条目之间还可以有关联（EntryLink），画成另一种连线。
"""
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session, select

from app.completeness import check_entry
from app.db import get_session
from app.levels import (EVOLUTION_PATHS, FORK_LEVEL, STAR_SKILL_MIN, entry_growth, kind_growth, level_tables,
                        path_weights, roll_path, satellites)
from app.models import (ENTRY_KINDS, RELATIONS, SKILL_CATEGORIES, Entry, EntryLink, KindEvolution,
                        skill_category)
from app.web import templates

router = APIRouter()

ORG_COLOR = "#9aa7c7"
ME_COLOR = "#ffffff"


def richness(entry: Entry) -> int:
    """条目有多“充实”：决定小球的大小和亮度。"""
    score = 1
    score += 1 if entry.description else 0
    score += min(len(entry.highlight_lines()), 3)
    score += min(len(entry.attachments), 2)
    score += min(len(entry.skills), 3)
    return score


def ensure_paths(session: Session, entries: list[Entry], entry_links: list[EntryLink],
                 rng=None) -> dict[str, str]:
    """返回每个大类的进化路线。大类第一次升到 Lv3 时掷骰子选一条并存下来，之后不再改变。"""
    paths = {row.kind: row.path for row in session.exec(select(KindEvolution)).all()}
    added = False
    for key in ENTRY_KINDS:
        group = [e for e in entries if e.kind == key]
        if key in paths or not group:
            continue
        if kind_growth(key, [entry_growth(e).level for e in group]).level < FORK_LEVEL:
            continue
        ids = {e.id for e in group}
        relations = sum(1 for link in entry_links if link.from_id in ids or link.to_id in ids)
        paths[key] = roll_path(path_weights(group, relations), rng)
        session.add(KindEvolution(kind=key, path=paths[key]))
        added = True
    if added:
        session.commit()
    return paths


def build_graph(entries: list[Entry], entry_links: list[EntryLink], paths: dict[str, str] | None = None) -> dict:
    nodes = [{"id": "me", "type": "me", "label": "我", "color": ME_COLOR, "size": 14,
              "count": len(entries)}]
    links = []
    paths = paths or {}

    growths = {e.id: entry_growth(e) for e in entries}

    # 类型分支（大类）：只为有条目的类型建节点；等级由下面的经历累积，等级越高球越大
    for key, kind in ENTRY_KINDS.items():
        levels = [growths[e.id].level for e in entries if e.kind == key]
        if levels:
            growth = kind_growth(key, levels, paths.get(key, ""))
            # 进化路线只在 Lv3 及以上生效（经历删掉后掉回 Lv2，路线仍然记着，再升上来还是它）
            path = paths.get(key, "") if growth.level >= FORK_LEVEL else ""
            evo = EVOLUTION_PATHS.get(path)
            nodes.append({"id": f"kind:{key}", "type": "kind", "kind": key, "label": kind.label,
                          "color": kind.color, "size": 5 + growth.level, "count": len(levels),
                          "growth": growth.level, "growthName": growth.name, "need": growth.need,
                          "progress": growth.progress, "nextSteps": growth.next_steps,
                          "path": path, "pathName": evo.name if evo else "", "pathIcon": evo.icon if evo else ""})
            links.append({"source": "me", "target": f"kind:{key}", "type": "tree"})

    skills, orgs = {}, {}
    for e in entries:
        kind = ENTRY_KINDS.get(e.kind, ENTRY_KINDS["other"])
        issues = check_entry(e)
        growth = growths[e.id]
        nodes.append({
            "id": f"entry:{e.id}",
            "type": "entry",
            "kind": e.kind if e.kind in ENTRY_KINDS else "other",
            "label": e.title,
            "color": kind.color,
            "size": 3 + richness(e) * 0.6,
            "kindLabel": kind.label,
            "period": e.period_text(),
            "year": int(e.start[:4]) if e.start else None,
            "org": e.org,
            "role": e.role,
            "level": e.level,
            "skills": [s.name for s in e.skills],
            "highlights": e.highlight_lines()[:2],
            "description": e.description[:120],
            "files": len(e.attachments),
            "issues": issues,
            "url": f"/entries/{e.id}",
            # 成长等级（见 levels.py）：决定卫星、光晕、星芒等特效
            "growth": growth.level,
            "growthName": growth.name,
            "progress": growth.progress,
            "nextSteps": growth.next_steps,
            "satellites": satellites(e) if growth.level >= 3 else [],
        })
        links.append({"source": f"kind:{e.kind if e.kind in ENTRY_KINDS else 'other'}",
                      "target": f"entry:{e.id}", "type": "tree"})

        for s in e.skills:
            skills.setdefault(s.id, {"name": s.name, "category": s.category, "entries": []})["entries"].append(e.id)
            links.append({"source": f"entry:{e.id}", "target": f"skill:{s.id}", "type": "skill"})
        if e.org:
            orgs.setdefault(e.org, []).append(e.id)
            links.append({"source": f"entry:{e.id}", "target": f"org:{e.org}", "type": "org"})

    for sid, s in skills.items():
        cat = skill_category(s["category"])
        nodes.append({"id": f"skill:{sid}", "type": "skill", "label": s["name"], "color": cat.color,
                      "category": s["category"], "categoryLabel": cat.label,
                      "size": 3 + len(s["entries"]) * 1.2, "count": len(s["entries"]),
                      "star": len(s["entries"]) >= STAR_SKILL_MIN,  # 核心技能：带晶体外壳
                      "url": f"/?skill={quote(s['name'])}"})
    for name, ids in orgs.items():
        nodes.append({"id": f"org:{name}", "type": "org", "label": name, "color": ORG_COLOR,
                      "size": 3 + len(ids) * 1.0, "count": len(ids)})

    # 条目之间的关联：起点 → 终点，带上从两端看的说法
    entry_ids = {e.id for e in entries}
    for link in entry_links:
        if link.from_id in entry_ids and link.to_id in entry_ids:
            out_label, in_label = RELATIONS.get(link.relation, RELATIONS["related"])
            links.append({"source": f"entry:{link.from_id}", "target": f"entry:{link.to_id}",
                          "type": "relation", "outLabel": out_label, "inLabel": in_label})

    return {"nodes": nodes, "links": links, "levels": level_tables()}


@router.get("/graph")
def graph_page(request: Request):
    return templates.TemplateResponse(request, "graph.html", {
        "nav": "graph",
        "kinds": ENTRY_KINDS,
        "skill_categories": SKILL_CATEGORIES,
        "org_color": ORG_COLOR,
    })


@router.get("/api/graph")
def graph_data(session: Session = Depends(get_session)):
    entries = list(session.exec(select(Entry)).all())
    entry_links = list(session.exec(select(EntryLink)).all())
    return build_graph(entries, entry_links, ensure_paths(session, entries, entry_links))
