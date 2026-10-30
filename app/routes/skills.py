"""技能管理：重命名、设置类别、合并重复技能、删除。"""
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session, func, select

from app.db import get_session
from app.models import SKILL_CATEGORIES, Skill
from app.web import get_or_404, redirect, templates

router = APIRouter()


def merge_into(source: Skill, target: Skill, session: Session) -> int:
    """把 source 的所有条目转到 target 名下，然后删掉 source。返回转移了几条经历。"""
    moved = 0
    for entry in list(source.entries):
        if target not in entry.skills:
            entry.skills.append(target)
            moved += 1
        entry.skills.remove(source)
    session.delete(source)
    return moved


@router.get("/skills")
def skills_page(request: Request, session: Session = Depends(get_session)):
    skills = sorted(session.exec(select(Skill)).all(), key=lambda s: (-len(s.entries), s.name.lower()))
    return templates.TemplateResponse(request, "skills.html", {
        "nav": "skills", "skills": skills, "categories": SKILL_CATEGORIES,
    })


@router.post("/skills/{skill_id}/update")
async def update_skill(request: Request, skill_id: int, session: Session = Depends(get_session)):
    """改名、改类别。改成一个已存在的名字时，直接合并过去。"""
    form = await request.form()
    skill = get_or_404(session, Skill, skill_id)
    name = form.get("name", "").strip()
    category = form.get("category", "")
    if not name:
        return redirect("/skills", "技能名不能为空")
    if category not in SKILL_CATEGORIES:
        category = ""

    same = session.exec(select(Skill).where(func.lower(Skill.name) == name.lower(), Skill.id != skill_id)).first()
    if same:
        old = skill.name
        merge_into(skill, same, session)
        session.commit()
        return redirect("/skills", f"「{same.name}」已存在，已把「{old}」合并过去")

    skill.name = name
    skill.category = category
    session.commit()
    return redirect("/skills", f"已保存「{name}」")


@router.post("/skills/{skill_id}/merge")
async def merge_skill(request: Request, skill_id: int, session: Session = Depends(get_session)):
    form = await request.form()
    source = get_or_404(session, Skill, skill_id)
    if not form.get("target_id") or int(form["target_id"]) == skill_id:
        return redirect("/skills", "请选择要合并到的技能")
    target = get_or_404(session, Skill, int(form["target_id"]))
    old = source.name
    moved = merge_into(source, target, session)
    session.commit()
    return redirect("/skills", f"已把「{old}」合并到「{target.name}」（转移了 {moved} 条经历）")


@router.post("/skills/{skill_id}/delete")
def delete_skill(skill_id: int, session: Session = Depends(get_session)):
    """删除技能，只会去掉经历上的这个标签，经历本身不受影响。"""
    skill = get_or_404(session, Skill, skill_id)
    name = skill.name
    for entry in list(skill.entries):
        entry.skills.remove(skill)
    session.delete(skill)
    session.commit()
    return redirect("/skills", f"已删除技能「{name}」")
