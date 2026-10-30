"""待归类：先把散落的证书、截图一股脑丢进来，之后再慢慢归到条目。"""
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session, select

from app.db import get_session
from app.models import Attachment, Entry
from app.web import redirect, save_form_files, sort_entries, templates

router = APIRouter()


@router.get("/inbox")
def inbox(request: Request, session: Session = Depends(get_session)):
    files = session.exec(
        select(Attachment).where(Attachment.entry_id.is_(None)).order_by(Attachment.created_at.desc())
    ).all()
    return templates.TemplateResponse(request, "inbox.html", {
        "nav": "inbox",
        "files": files,
        "entries": sort_entries(list(session.exec(select(Entry)).all())),
    })


@router.post("/inbox/upload")
async def upload(request: Request, session: Session = Depends(get_session)):
    msg = await save_form_files(session, await request.form(), None)
    session.commit()
    return redirect("/inbox", msg or "没有选择文件")
