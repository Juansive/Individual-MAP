"""页面渲染和路由共用的小工具。"""
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, func, select
from starlette.datastructures import FormData, UploadFile

from app import vault
from app.completeness import check_entry
from app.config import STATIC_DIR, TEMPLATES_DIR
from app.db import engine
from app.models import ENTRY_KINDS, Attachment, Entry, kind_of


def inbox_count() -> int:
    with Session(engine) as session:
        return session.exec(select(func.count()).select_from(Attachment).where(Attachment.entry_id.is_(None))).one()


def format_size(n: int) -> str:
    for unit in ("B", "KB", "MB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def static_url(path: str) -> str:
    """静态文件地址带上修改时间作为版本号，文件一改浏览器就会重新下载，不用强制刷新。"""
    try:
        version = int((STATIC_DIR / path).stat().st_mtime)
    except OSError:
        version = 0
    return f"/static/{path}?v={version}"


templates = Jinja2Templates(directory=TEMPLATES_DIR)
templates.env.globals.update(
    static_url=static_url,
    ENTRY_KINDS=ENTRY_KINDS,
    kind_of=kind_of,
    check_entry=check_entry,
    inbox_count=inbox_count,
    filesize=format_size,
)


def redirect(url: str, msg: str = "") -> RedirectResponse:
    """跳转到 url，并在页面顶部显示一条提示。"""
    if msg:
        url += ("&" if "?" in url else "?") + "msg=" + quote(msg)
    return RedirectResponse(url, status_code=303)


def back_to(form, default: str = "/") -> str:
    """表单里带了 next 就跳回那个页面（只允许站内路径）。"""
    target = form.get("next", "")
    return target if target.startswith("/") and not target.startswith("//") else default


def get_or_404(session: Session, model, obj_id: int):
    obj = session.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, "找不到这条记录")
    return obj


def sort_entries(entries: list[Entry]) -> list[Entry]:
    """按时间倒序；没填时间的排在最后。"""
    return sorted(entries, key=lambda e: (e.start or "", e.id), reverse=True)


async def save_form_files(session: Session, form: FormData, entry: Entry | None) -> str:
    """保存表单里名为 files 的所有上传文件，返回给用户看的结果说明。"""
    saved, reused, skipped = 0, 0, []
    for f in form.getlist("files"):
        if not isinstance(f, UploadFile) or not f.filename:
            continue
        att, created = vault.save_upload(session, await f.read(), f.filename, entry)
        if created:
            saved += 1
        elif entry is not None and att.entry_id is None:
            # 这个文件之前丢在“待归类”里，现在顺手归到这个条目
            vault.assign(att, entry)
            reused += 1
        else:
            skipped.append(f.filename)

    parts = []
    if saved:
        parts.append(f"保存了 {saved} 个文件")
    if reused:
        parts.append(f"{reused} 个文件已从待归类移入")
    if skipped:
        parts.append(f"{len(skipped)} 个文件之前已存过，已跳过（{'、'.join(skipped[:3])}）")
    return "，".join(parts)
