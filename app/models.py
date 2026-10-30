"""数据模型。

- Entry      条目：一段经历或一项荣誉（项目、实习、奖项、证书……）
- Skill      技能标签，和条目多对多
- Attachment 证明文件，属于某个条目；entry_id 为空表示还在“待归类”
- EntryLink  条目之间的关联（比如奖项来自某个项目）
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from pydantic import NaiveDatetime
from sqlmodel import Field, Relationship, SQLModel


@dataclass(frozen=True)
class Kind:
    label: str
    color: str
    needs_proof: bool = False    # 通常应该有证明文件（证书、奖状、录用通知……）
    needs_numbers: bool = False  # 通常应该写可量化的成果
    needs_skills: bool = False   # 通常应该关联技能标签


# 条目类型：key 存进数据库，Kind 决定显示和完整度检查规则
ENTRY_KINDS: dict[str, Kind] = {
    "education": Kind("教育经历", "#4f7cff", needs_proof=True),
    "internship": Kind("实习/工作", "#12a594", needs_numbers=True, needs_skills=True),
    "project": Kind("项目经历", "#8e4ec6", needs_numbers=True, needs_skills=True),
    "competition": Kind("竞赛", "#e5484d", needs_proof=True),
    "award": Kind("奖项荣誉", "#e28a00", needs_proof=True),
    "certificate": Kind("证书资格", "#0090ff", needs_proof=True),
    "research": Kind("科研/论文", "#d6409f", needs_proof=True, needs_skills=True),
    "campus": Kind("校园活动", "#30a46c", needs_numbers=True),
    "volunteer": Kind("志愿公益", "#a0682a"),
    "other": Kind("其他", "#8b8d98"),
}


def kind_of(key: str) -> Kind:
    return ENTRY_KINDS.get(key, ENTRY_KINDS["other"])


@dataclass(frozen=True)
class SkillCategory:
    label: str
    color: str  # 星图里技能节点的颜色


# 技能类别：空字符串表示未分类
SKILL_CATEGORIES: dict[str, SkillCategory] = {
    "tech": SkillCategory("技术", "#5ee7ff"),
    "tool": SkillCategory("工具", "#6fe3b0"),
    "language": SkillCategory("语言", "#b9a6ff"),
    "soft": SkillCategory("软技能", "#ff9ec4"),
    "": SkillCategory("未分类", "#9fd3e0"),
}


def skill_category(key: str) -> SkillCategory:
    return SKILL_CATEGORIES.get(key, SKILL_CATEGORIES[""])


# 条目关联的关系类型：(从“起点”条目看的说法, 从“终点”条目看的说法)
RELATIONS: dict[str, tuple[str, str]] = {
    "produced": ("产出", "来自"),      # 项目 产出 奖项；奖项 来自 项目
    "during": ("期间", "期间于"),      # 本科 期间 参加了社团；社团 期间于 本科
    "related": ("相关", "相关"),
}


class EntrySkillLink(SQLModel, table=True):
    entry_id: int = Field(foreign_key="entry.id", primary_key=True)
    skill_id: int = Field(foreign_key="skill.id", primary_key=True)


class Skill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    category: str = ""

    entries: list["Entry"] = Relationship(back_populates="skills", link_model=EntrySkillLink)


class Entry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(default="other", index=True)
    title: str
    org: str = ""          # 机构：学校 / 公司 / 主办方 / 颁发单位
    role: str = ""         # 角色、职位或名次
    level: str = ""        # 级别：国家级 / 省级 / 校级……
    start: str = ""        # 开始时间（或获得时间），格式 YYYY-MM
    end: str = ""          # 结束时间，空表示单个时间点，"now" 表示至今
    description: str = ""  # 原始描述，随手写的话
    highlights: str = ""   # 成果要点，一行一条
    created_at: NaiveDatetime = Field(default_factory=datetime.now)
    updated_at: NaiveDatetime = Field(default_factory=datetime.now)

    skills: list[Skill] = Relationship(back_populates="entries", link_model=EntrySkillLink)
    attachments: list["Attachment"] = Relationship(back_populates="entry")

    def period_text(self) -> str:
        def fmt(v: str) -> str:
            return "至今" if v == "now" else v.replace("-", ".")

        if not self.start:
            return "时间未填"
        if self.end and self.end != self.start:
            return f"{fmt(self.start)} – {fmt(self.end)}"
        return fmt(self.start)

    def highlight_lines(self) -> list[str]:
        return [line.strip(" -•\t") for line in self.highlights.splitlines() if line.strip(" -•\t")]


class EntryLink(SQLModel, table=True):
    """条目之间的关联，有方向：from_id --relation--> to_id。"""
    id: Optional[int] = Field(default=None, primary_key=True)
    from_id: int = Field(foreign_key="entry.id", index=True)
    to_id: int = Field(foreign_key="entry.id", index=True)
    relation: str = "related"  # RELATIONS 的 key
    created_at: NaiveDatetime = Field(default_factory=datetime.now)


class Attachment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entry_id: Optional[int] = Field(default=None, foreign_key="entry.id", index=True)
    original_name: str
    stored_path: str               # 相对 vault 目录的路径
    sha256: str = Field(index=True, unique=True)  # 用内容哈希去重：同一个文件只存一份
    mime: str = ""
    size: int = 0
    created_at: NaiveDatetime = Field(default_factory=datetime.now)

    entry: Optional[Entry] = Relationship(back_populates="attachments")

    @property
    def is_image(self) -> bool:
        return self.mime.startswith("image/")

    @property
    def is_pdf(self) -> bool:
        return self.mime == "application/pdf"

    @property
    def ext(self) -> str:
        return self.original_name.rsplit(".", 1)[-1].upper() if "." in self.original_name else "FILE"
