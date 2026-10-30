"""条目：列表 / 时间轴、快速记录、新建、编辑、删除。"""
import re
from datetime import datetime
from itertools import groupby

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session, func, select

from app import vault
from app.completeness import check_entry
from app.db import get_session
from app.models import ENTRY_KINDS, Attachment, Entry, Skill
from app.routes.links import LINK_CHOICES, delete_links_of, links_of
from app.web import get_or_404, redirect, save_form_files, sort_entries, templates

router = APIRouter()

_SKILL_SPLIT = re.compile(r"[,，、;；\n]+")


def parse_skill_names(text: str) -> list[str]:
    names, seen = [], set()
    for part in _SKILL_SPLIT.split(text):
        name = part.strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


def set_skills(session: Session, entry: Entry, names: list[str]) -> None:
    skills = []
    for name in names:
        skill = session.exec(select(Skill).where(func.lower(Skill.name) == name.lower())).first()
        skills.append(skill or Skill(name=name))
    entry.skills = skills


def matches(entry: Entry, query: str) -> bool:
    """关键词搜索：空格分隔的每个词都要出现在条目的某个字段里。"""
    haystack = " ".join([
        entry.title, entry.org, entry.role, entry.level, entry.description, entry.highlights,
        *(s.name for s in entry.skills),
        *(a.original_name for a in entry.attachments),
    ]).lower()
    return all(word in haystack for word in query.lower().split())


def apply_form(entry: Entry, form) -> None:
    """把编辑表单的字段写进条目。"""
    entry.kind = form.get("kind") if form.get("kind") in ENTRY_KINDS else "other"
    entry.title = form.get("title", "").strip() or "未命名条目"
    entry.org = form.get("org", "").strip()
    entry.role = form.get("role", "").strip()
    entry.level = form.get("level", "").strip()
    entry.start = form.get("start", "")
    entry.end = "now" if form.get("ongoing") else form.get("end", "")
    entry.description = form.get("description", "").strip()
    entry.highlights = form.get("highlights", "").strip()
    entry.updated_at = datetime.now()


@router.get("/")
def index(request: Request, q: str = "", kind: str = "", year: str = "", skill: str = "",
          todo: bool = False, view: str = "timeline", session: Session = Depends(get_session)):
    all_entries = list(session.exec(select(Entry)).all())

    # 数据量是几百条级别，直接在 Python 里筛选，简单直观
    shown = all_entries
    if kind:
        shown = [e for e in shown if e.kind == kind]
    if year:
        shown = [e for e in shown if e.start.startswith(year)]
    if skill:
        shown = [e for e in shown if any(s.name == skill for s in e.skills)]
    if q.strip():
        shown = [e for e in shown if matches(e, q)]
    if todo:
        shown = [e for e in shown if check_entry(e)]
    shown = sort_entries(shown)

    groups = [(y, list(items)) for y, items in groupby(shown, key=lambda e: e.start[:4] or "未注明时间")]
    skills = [s for s in session.exec(select(Skill).order_by(Skill.name)).all() if s.entries]

    return templates.TemplateResponse(request, "index.html", {
        "nav": "entries",
        "entries": shown,
        "groups": groups,
        "total": len(all_entries),
        "todo_count": sum(1 for e in all_entries if check_entry(e)),
        "years": sorted({e.start[:4] for e in all_entries if e.start}, reverse=True),
        "skills": skills,
        "q": q, "kind": kind, "year": year, "skill": skill, "todo": todo,
        "view": view if view in ("timeline", "list") else "timeline",
        "filtering": bool(q or kind or year or skill or todo),
    })


@router.post("/entries/quick")
async def quick_add(request: Request, session: Session = Depends(get_session)):
    """快速记录：只要标题，其余都可以以后再补。"""
    form = await request.form()
    kind = form.get("kind")
    entry = Entry(
        kind=kind if kind in ENTRY_KINDS else "other",
        title=form.get("title", "").strip() or "未命名条目",
        start=form.get("start", ""),
        description=form.get("note", "").strip(),
    )
    session.add(entry)
    session.flush()  # 先拿到 entry.id，文件归档要用
    file_msg = await save_form_files(session, form, entry)
    session.commit()
    return redirect("/", f"已记录「{entry.title}」" + (f"，{file_msg}" if file_msg else ""))


@router.get("/entries/new")
def new_form(request: Request, session: Session = Depends(get_session)):
    return templates.TemplateResponse(request, "entry_form.html", {
        "nav": "entries",
        "entry": Entry(title="", kind=request.query_params.get("kind", "project")),
        "skill_text": "",
        "all_skills": session.exec(select(Skill).order_by(Skill.name)).all(),
    })


@router.post("/entries/new")
async def create(request: Request, session: Session = Depends(get_session)):
    form = await request.form()
    entry = Entry(title="")
    apply_form(entry, form)
    set_skills(session, entry, parse_skill_names(form.get("skills", "")))
    session.add(entry)
    session.flush()
    file_msg = await save_form_files(session, form, entry)
    session.commit()
    return redirect("/", f"已保存「{entry.title}」" + (f"，{file_msg}" if file_msg else ""))


@router.get("/entries/{entry_id}")
def detail(request: Request, entry_id: int, session: Session = Depends(get_session)):
    entry = get_or_404(session, Entry, entry_id)
    inbox_files = session.exec(
        select(Attachment).where(Attachment.entry_id.is_(None)).order_by(Attachment.created_at.desc())
    ).all()
    others = [e for e in sort_entries(list(session.exec(select(Entry)).all())) if e.id != entry_id]
    return templates.TemplateResponse(request, "entry_detail.html", {
        "nav": "entries", "entry": entry, "issues": check_entry(entry), "inbox_files": inbox_files,
        "links": links_of(session, entry_id), "link_choices": LINK_CHOICES, "other_entries": others,
    })


@router.get("/entries/{entry_id}/edit")
def edit_form(request: Request, entry_id: int, session: Session = Depends(get_session)):
    entry = get_or_404(session, Entry, entry_id)
    return templates.TemplateResponse(request, "entry_form.html", {
        "nav": "entries",
        "entry": entry,
        "skill_text": "、".join(s.name for s in entry.skills),
        "all_skills": session.exec(select(Skill).order_by(Skill.name)).all(),
    })


@router.post("/entries/{entry_id}/edit")
async def update(request: Request, entry_id: int, session: Session = Depends(get_session)):
    entry = get_or_404(session, Entry, entry_id)
    form = await request.form()
    apply_form(entry, form)
    set_skills(session, entry, parse_skill_names(form.get("skills", "")))
    # 标题、时间、类型改了，已有的证明文件跟着移动、改名
    moved = sum(vault.organize(att) for att in entry.attachments)
    file_msg = await save_form_files(session, form, entry)
    session.commit()
    vault.prune_empty_dirs()
    parts = [f"已保存「{entry.title}」"] + ([f"{moved} 个文件已按新信息重新整理"] if moved else []) + ([file_msg] if file_msg else [])
    return redirect("/", "，".join(parts))


@router.post("/entries/{entry_id}/delete")
def delete(entry_id: int, session: Session = Depends(get_session)):
    """删除条目。它的证明文件不会删，而是放回“待归类”。"""
    entry = get_or_404(session, Entry, entry_id)
    title = entry.title
    moved = len(entry.attachments)
    for att in list(entry.attachments):
        vault.assign(att, None)
    entry.skills = []
    delete_links_of(session, entry_id)
    session.delete(entry)
    session.commit()
    vault.prune_empty_dirs()
    msg = f"已删除「{title}」" + (f"，{moved} 个文件已放回待归类" if moved else "")
    return redirect("/", msg)
