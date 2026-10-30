"""证明文件：查看、上传到条目、归类、删除、在资源管理器中显示。"""
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import Session

from app import vault
from app.db import get_session
from app.models import Attachment, Entry
from app.web import back_to, get_or_404, redirect, save_form_files

router = APIRouter()


@router.get("/files/{att_id}")
def view_file(att_id: int, session: Session = Depends(get_session)):
    att = get_or_404(session, Attachment, att_id)
    path = vault.file_path(att)
    if not path.exists():
        raise HTTPException(404, "文件不在归档目录里了，可能被手动移动或删除")
    return FileResponse(path, media_type=att.mime, filename=att.original_name,
                        content_disposition_type="inline")


@router.post("/entries/{entry_id}/files")
async def upload_to_entry(request: Request, entry_id: int, session: Session = Depends(get_session)):
    entry = get_or_404(session, Entry, entry_id)
    msg = await save_form_files(session, await request.form(), entry)
    session.commit()
    return redirect(f"/entries/{entry_id}", msg or "没有选择文件")


@router.post("/files/{att_id}/assign")
async def assign(request: Request, att_id: int, session: Session = Depends(get_session)):
    """把文件归到某个条目；entry_id 为空则放回待归类。"""
    form = await request.form()
    att = get_or_404(session, Attachment, att_id)
    entry = get_or_404(session, Entry, int(form["entry_id"])) if form.get("entry_id") else None
    vault.assign(att, entry)
    session.commit()
    msg = f"「{att.original_name}」已归到「{entry.title}」" if entry else f"「{att.original_name}」已放回待归类"
    return redirect(back_to(form), msg)


@router.post("/files/{att_id}/new-entry")
def new_entry_from_file(att_id: int, session: Session = Depends(get_session)):
    """用一个待归类的文件直接新建条目，然后去编辑页补全信息。"""
    att = get_or_404(session, Attachment, att_id)
    entry = Entry(kind="award", title=Path(att.original_name).stem)
    session.add(entry)
    session.flush()
    vault.assign(att, entry)
    session.commit()
    return redirect(f"/entries/{entry.id}/edit", "已用这个文件新建条目，请补全信息")


@router.post("/files/{att_id}/delete")
async def delete_file(request: Request, att_id: int, session: Session = Depends(get_session)):
    form = await request.form()
    att = get_or_404(session, Attachment, att_id)
    name = att.original_name
    vault.trash(session, att)
    session.commit()
    return redirect(back_to(form), f"「{name}」已移到 data/trash")


@router.post("/files/{att_id}/reveal")
async def reveal(request: Request, att_id: int, session: Session = Depends(get_session)):
    """在 Windows 资源管理器里定位到这个文件。"""
    form = await request.form()
    att = get_or_404(session, Attachment, att_id)
    path = vault.file_path(att)
    if os.name == "nt" and path.exists():
        subprocess.Popen(["explorer", "/select,", str(path)])
    return redirect(back_to(form))
