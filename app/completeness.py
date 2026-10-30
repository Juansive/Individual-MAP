"""完整度检查：在写简历之前，提前发现素材缺了什么。"""
import re

from app.models import Entry, kind_of

_HAS_NUMBER = re.compile(r"\d")


def check_entry(entry: Entry) -> list[str]:
    """返回该条目缺少的内容，空列表表示已经完整。"""
    kind = kind_of(entry.kind)
    issues = []
    if not entry.start:
        issues.append("缺时间")
    if not entry.org and entry.kind != "other":
        issues.append("缺机构")
    if not entry.description.strip() and not entry.highlights.strip():
        issues.append("缺描述")
    if kind.needs_proof and not entry.attachments:
        issues.append("缺证明文件")
    if kind.needs_numbers:
        if not entry.highlights.strip():
            issues.append("缺成果要点")
        elif not _HAS_NUMBER.search(entry.highlights):
            issues.append("成果未量化")
    if kind.needs_skills and not entry.skills:
        issues.append("缺技能标签")
    return issues
