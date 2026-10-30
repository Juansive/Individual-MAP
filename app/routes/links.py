"""条目之间的关联：添加、取消。"""
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session, and_, or_, select

from app.db import get_session
from app.models import RELATIONS, Entry, EntryLink
from app.web import back_to, get_or_404, redirect

router = APIRouter()

# 详情页“添加关联”下拉框的选项：值是“关系:方向”，out 表示当前条目是起点
LINK_CHOICES = [
    ("produced:out", "产出了…（项目 → 奖项）"),
    ("produced:in", "来自…（奖项 ← 项目）"),
    ("during:out", "期间有…（本科 → 社团）"),
    ("during:in", "发生在…期间（社团 ← 本科）"),
    ("related:out", "相关"),
]


def _touching(entry_id: int):
    return or_(EntryLink.from_id == entry_id, EntryLink.to_id == entry_id)


def links_of(session: Session, entry_id: int) -> list[dict]:
    """某个条目的全部关联，按“从这个条目看”的说法返回。"""
    result = []
    for link in session.exec(select(EntryLink).where(_touching(entry_id))).all():
        outgoing = link.from_id == entry_id
        other = session.get(Entry, link.to_id if outgoing else link.from_id)
        if other is None:
            continue
        labels = RELATIONS.get(link.relation, RELATIONS["related"])
        result.append({"id": link.id, "label": labels[0] if outgoing else labels[1], "entry": other})
    return result


def delete_links_of(session: Session, entry_id: int) -> None:
    for link in session.exec(select(EntryLink).where(_touching(entry_id))).all():
        session.delete(link)


@router.post("/entries/{entry_id}/links")
async def add_link(request: Request, entry_id: int, session: Session = Depends(get_session)):
    form = await request.form()
    here = f"/entries/{entry_id}"
    get_or_404(session, Entry, entry_id)
    target_id = int(form.get("target_id") or 0)
    relation, _, direction = form.get("relation", "related:out").partition(":")

    target = session.get(Entry, target_id)
    if relation not in RELATIONS or target is None or target_id == entry_id:
        return redirect(here, "请选择另一条经历")
    pair = or_(and_(EntryLink.from_id == entry_id, EntryLink.to_id == target_id),
               and_(EntryLink.from_id == target_id, EntryLink.to_id == entry_id))
    if session.exec(select(EntryLink).where(pair)).first():
        return redirect(here, f"已经和「{target.title}」关联过了")

    from_id, to_id = (target_id, entry_id) if direction == "in" else (entry_id, target_id)
    session.add(EntryLink(from_id=from_id, to_id=to_id, relation=relation))
    session.commit()
    return redirect(here, f"已关联「{target.title}」")


@router.post("/links/{link_id}/delete")
async def delete_link(request: Request, link_id: int, session: Session = Depends(get_session)):
    form = await request.form()
    session.delete(get_or_404(session, EntryLink, link_id))
    session.commit()
    return redirect(back_to(form), "已取消关联")
