"""导出与备份：Markdown 导出（方便贴给 AI 或写简历），整库 zip 备份。"""
import os
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import Session, func, select

from app import backup, vault
from app.config import BACKUP_DIR, VAULT_DIR
from app.db import get_session
from app.models import ENTRY_KINDS, Attachment, Entry
from app.web import redirect, sort_entries, templates

router = APIRouter()


def entries_markdown(entries: list[Entry]) -> str:
    lines = ["# 个人素材库", "", f"导出时间：{datetime.now():%Y-%m-%d %H:%M}", ""]
    for key, kind in ENTRY_KINDS.items():
        group = sort_entries([e for e in entries if e.kind == key])
        if not group:
            continue
        lines += [f"## {kind.label}", ""]
        for e in group:
            lines.append(f"### {e.title}")
            meta = " | ".join(x for x in (e.period_text(), e.org, e.role, e.level) if x)
            lines.append(f"- {meta}")
            if e.skills:
                lines.append("- 技能：" + "、".join(s.name for s in e.skills))
            if e.attachments:
                lines.append("- 证明文件：" + "、".join(a.original_name for a in e.attachments))
            if e.description:
                lines += ["", e.description]
            if e.highlight_lines():
                lines += ["", "成果要点："] + [f"- {h}" for h in e.highlight_lines()]
            lines.append("")
    return "\n".join(lines)


@router.get("/export")
def export_page(request: Request, session: Session = Depends(get_session)):
    backups = sorted(BACKUP_DIR.glob("*.zip"), reverse=True)[:5]
    snapshots = backup.auto_snapshots()
    return templates.TemplateResponse(request, "export.html", {
        "nav": "export",
        "entry_count": session.exec(select(func.count()).select_from(Entry)).one(),
        "file_count": session.exec(select(func.count()).select_from(Attachment)).one(),
        "backups": backups,
        "snapshot_count": len(snapshots),
        "latest_snapshot": datetime.fromtimestamp(snapshots[-1].stat().st_mtime) if snapshots else None,
        "keep_auto": backup.KEEP_AUTO,
    })


@router.get("/export/markdown")
def export_markdown(session: Session = Depends(get_session)):
    text = entries_markdown(list(session.exec(select(Entry)).all()))
    filename = f"素材库_{datetime.now():%Y%m%d}.md"
    return PlainTextResponse(text, media_type="text/markdown; charset=utf-8", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    })


@router.get("/export/backup")
def export_backup():
    """把数据库和全部归档文件打成一个 zip，同时在 data/backups 留一份。"""
    zip_path = backup.full_backup()
    return FileResponse(zip_path, filename=zip_path.name)


@router.post("/vault/organize")
def organize_vault(session: Session = Depends(get_session)):
    """把全部证明文件按现在的命名规则重新整理一遍。"""
    moved, missing = vault.organize_all(session)
    session.commit()
    vault.prune_empty_dirs()
    msg = f"整理完成：移动了 {moved} 个文件" if moved else "所有文件都已经整理好了"
    if missing:
        msg += f"；有 {missing} 个文件在归档目录里找不到（可能被手动移动或删除了）"
    return redirect("/export", msg)


@router.post("/vault/open")
def open_vault():
    if os.name == "nt":
        os.startfile(VAULT_DIR)
    return redirect("/export")
