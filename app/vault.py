"""证明文件归档。

文件统一存到 data/vault/ 下：
    vault/2024/奖项荣誉/2024-05_数学建模省一等奖_证书.jpg
    vault/_待归类/扫描件001.pdf
同一个文件（内容相同）只存一份；删除时移到 data/trash/，不直接删掉。
"""
import hashlib
import mimetypes
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from app.config import TRASH_DIR, VAULT_DIR
from app.models import Attachment, Entry, kind_of

INBOX_FOLDER = "_待归类"
_INVALID = re.compile(r'[\\/:*?"<>|\s]+')


def safe_name(text: str, max_len: int = 40) -> str:
    """把任意文字变成安全的文件名片段。"""
    text = _INVALID.sub("_", text).strip("._")
    return text[:max_len] or "未命名"


def folder_for(entry: Optional[Entry]) -> Path:
    if entry is None:
        return Path(INBOX_FOLDER)
    year = entry.start[:4] if entry.start else "未注明年份"
    return Path(year) / safe_name(kind_of(entry.kind).label)


def name_for(entry: Optional[Entry], original_name: str) -> str:
    original = Path(original_name)
    ext = original.suffix.lower()
    if entry is None:
        return safe_name(original.stem, 60) + ext
    prefix = f"{entry.start}_" if entry.start else ""
    return f"{prefix}{safe_name(entry.title)}_{safe_name(original.stem, 20)}{ext}"


def unique_path(folder: Path, name: str) -> Path:
    """目标文件已存在时自动加 _2、_3 …"""
    path = folder / name
    n = 2
    while path.exists():
        path = folder / f"{Path(name).stem}_{n}{Path(name).suffix}"
        n += 1
    return path


def file_path(att: Attachment) -> Path:
    return VAULT_DIR / att.stored_path


def find_by_hash(session: Session, digest: str) -> Optional[Attachment]:
    return session.exec(select(Attachment).where(Attachment.sha256 == digest)).first()


def save_upload(session: Session, data: bytes, original_name: str,
                entry: Optional[Entry]) -> tuple[Attachment, bool]:
    """保存上传的文件。返回 (附件, 是否新建)；内容重复时返回已有的附件。"""
    digest = hashlib.sha256(data).hexdigest()
    existing = find_by_hash(session, digest)
    if existing:
        return existing, False

    folder = VAULT_DIR / folder_for(entry)
    folder.mkdir(parents=True, exist_ok=True)
    path = unique_path(folder, name_for(entry, original_name))
    att = Attachment(
        entry_id=entry.id if entry else None,
        original_name=original_name,
        stored_path=path.relative_to(VAULT_DIR).as_posix(),
        sha256=digest,
        mime=mimetypes.guess_type(original_name)[0] or "application/octet-stream",
        size=len(data),
    )
    session.add(att)
    session.flush()  # 先确认数据库能写入，再落盘，避免留下没有记录的孤儿文件
    path.write_bytes(data)
    return att, True


def assign(att: Attachment, entry: Optional[Entry]) -> None:
    """把文件归到某个条目（entry 为 None 则放回待归类），同时移动到对应文件夹。"""
    src = file_path(att)
    folder = VAULT_DIR / folder_for(entry)
    folder.mkdir(parents=True, exist_ok=True)
    dest = unique_path(folder, name_for(entry, att.original_name))
    if src.exists():
        shutil.move(src, dest)
    att.stored_path = dest.relative_to(VAULT_DIR).as_posix()
    att.entry_id = entry.id if entry else None


def expected_path(att: Attachment) -> Path:
    """按当前条目信息，这个文件“应该”放在哪（相对 vault）。"""
    return folder_for(att.entry) / name_for(att.entry, att.original_name)


def is_organized(att: Attachment) -> bool:
    current, expected = Path(att.stored_path), expected_path(att)
    if current.parent != expected.parent:
        return False
    # 重名时自动加的 _2、_3 也算整理好了
    pattern = re.escape(expected.stem) + r"(_\d+)?" + re.escape(expected.suffix)
    return re.fullmatch(pattern, current.name) is not None


def organize(att: Attachment) -> bool:
    """文件位置和条目信息对不上（比如改了标题或时间）就移过去；返回是否移动了。"""
    if is_organized(att):
        return False
    assign(att, att.entry)
    return True


def organize_all(session: Session) -> tuple[int, int]:
    """整理全部文件，返回 (移动了几个, 有几个文件在磁盘上找不到)。"""
    moved = missing = 0
    for att in session.exec(select(Attachment)).all():
        if not file_path(att).exists():
            missing += 1
        elif organize(att):
            moved += 1
    return moved, missing


def prune_empty_dirs() -> None:
    """文件移走后留下的空文件夹顺手删掉（待归类文件夹保留）。"""
    dirs = sorted((p for p in VAULT_DIR.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True)
    for d in dirs:
        if d.name != INBOX_FOLDER and not any(d.iterdir()):
            d.rmdir()


def trash(session: Session, att: Attachment) -> None:
    src = file_path(att)
    if src.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        shutil.move(src, unique_path(TRASH_DIR, f"{stamp}_{src.name}"))
    session.delete(att)
