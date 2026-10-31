"""成长等级：经历越充实、大类积累越多，星图里的球越有“排面”。

特效按层级分配，保证大类始终比它下面的分支更耀眼：
- 分支（单条经历）：卫星（每颗代表一个证明文件或成果要点）、完整后的柔光晕、满级的十字星芒
- 大类（教育经历、竞赛……）：随等级变大，每升一级多一样东西（见 KIND_LEVELS）

分支等级（反映这条经历写得多完整）：
    Lv1 星尘      只有标题
    Lv2 行星      有时间和描述（或成果要点）
    Lv3 卫星行星  再有证明文件或成果要点
    Lv4 光晕行星  完整度检查全部通过
    Lv5 闪耀行星  完整，且（2 条以上带数字的成果 + 2 个以上技能，或者级别为国家级/国际级）
每一级都要求先满足上一级。

大类等级（反映这个领域攒了多少、写得多好）：
    成长值 = 下面每条经历的等级之和；满级目标 = 目标条数 × 5
    进度 = 成长值 ÷ 满级目标（最多 100%），按 KIND_LEVELS 的门槛分成 8 级：前面密、后面疏，
    刚开始很快就能升级，越往后越难。满级始终是 100%，所以每个大类都有机会到顶。
不同大类天然条数差别大（教育一般 1~3 条，奖项可能十几条），所以每类有自己的目标条数。
"""
import math
import re
from dataclasses import dataclass, field

from app.completeness import check_entry
from app.models import Entry

ENTRY_LEVEL_NAMES = {1: "星尘", 2: "行星", 3: "卫星行星", 4: "光晕行星", 5: "闪耀行星"}

# 大类 8 级：(进度门槛 %, 名字)。星图里每升一级多一样外观：
# 星雾 → 变大变亮 → 伴星 → 星环 → 第二道星环 → 日冕 → 双臂星系盘 → 三臂星系盘 + 金色光晕
KIND_LEVELS = [
    (0, "星云"), (10, "原恒星"), (20, "星团"), (35, "环带恒星"),
    (50, "双环恒星"), (65, "日冕恒星"), (80, "旋涡星系"), (100, "璀璨星系"),
]
KIND_LEVEL_NAMES = {i + 1: name for i, (_, name) in enumerate(KIND_LEVELS)}

# 每个大类大约需要几条写满（Lv5）的经历才算满级
KIND_TARGETS = {
    "education": 2, "research": 2, "volunteer": 2,
    "internship": 3, "campus": 3, "other": 3,
    "project": 4, "competition": 4, "certificate": 4,
    "award": 6,
}

TOP_LEVELS = {"国家级", "国际级"}
RANKED_KINDS = {"competition", "award", "certificate", "research"}  # 这几类通常有级别，升级提示里才提“级别”
STAR_SKILL_MIN = 4
MAX_SATELLITES = 6

_HAS_NUMBER = re.compile(r"\d")


@dataclass
class Growth:
    level: int
    name: str
    progress: float                                       # 0~1，进度条用
    next_steps: list[str] = field(default_factory=list)  # 升到下一级还差什么；满级为空


def _entry(level: int, steps: list[str] | None = None) -> Growth:
    return Growth(level, ENTRY_LEVEL_NAMES[level], level / 5, steps or [])


def quantified_count(entry: Entry) -> int:
    return sum(1 for line in entry.highlight_lines() if _HAS_NUMBER.search(line))


def entry_growth(entry: Entry) -> Growth:
    # Lv2：有时间和描述
    missing = []
    if not entry.start:
        missing.append("填写时间")
    if not entry.description.strip() and not entry.highlights.strip():
        missing.append("写几句描述")
    if missing:
        return _entry(1, missing)

    # Lv3：有证明文件或成果要点
    if not entry.attachments and not entry.highlight_lines():
        return _entry(2, ["上传一个证明文件，或写一条成果要点"])

    # Lv4：完整度检查全部通过
    issues = check_entry(entry)
    if issues:
        return _entry(3, [f"补全：{'、'.join(issues)}"])

    # Lv5：量化成果 + 技能，或者高级别
    if entry.level in TOP_LEVELS:
        return _entry(5)
    need_numbers = max(0, 2 - quantified_count(entry))
    need_skills = max(0, 2 - len(entry.skills))
    if not need_numbers and not need_skills:
        return _entry(5)
    steps = []
    if need_numbers:
        steps.append(f"再写 {need_numbers} 条带数字的成果")
    if need_skills:
        steps.append(f"再加 {need_skills} 个技能标签")
    if entry.kind in RANKED_KINDS:
        steps[-1] += "（或者级别是国家级/国际级）"
    return _entry(4, steps)


@dataclass
class KindGrowth(Growth):
    need: int = 0  # 升到下一级还差几点成长值；满级为 0（“离升级最近”用）


def kind_growth(kind: str, entry_levels: list[int]) -> KindGrowth:
    """大类等级：由下面所有经历的等级累积而来。"""
    goal = KIND_TARGETS.get(kind, 3) * 5
    points = sum(entry_levels)
    # 用整数比较门槛（成长值 × 100 ≥ 目标 × 百分比），避免小数误差
    level = max(i + 1 for i, (pct, _) in enumerate(KIND_LEVELS) if points * 100 >= goal * pct)
    growth = KindGrowth(level, KIND_LEVEL_NAMES[level], min(1.0, points / goal))
    if level < len(KIND_LEVELS):
        growth.need = math.ceil(goal * KIND_LEVELS[level][0] / 100) - points
        growth.next_steps = [f"再攒 {growth.need} 点成长值升到 Lv.{level + 1}"
                             "（每条经历按等级计 1~5 点，新增或补全经历都算）"]
    return growth


def level_tables() -> dict:
    """两套等级的名称表，星图的“点亮进度”面板用。"""
    return {
        "entry": [{"level": lv, "name": name} for lv, name in ENTRY_LEVEL_NAMES.items()],
        "kind": [{"level": lv, "name": name} for lv, name in KIND_LEVEL_NAMES.items()],
    }


def satellites(entry: Entry) -> list[dict]:
    """Lv3 起的卫星：每颗代表一个证明文件或一条成果要点。"""
    items = [{"type": "file", "label": a.original_name} for a in entry.attachments]
    items += [{"type": "highlight", "label": h} for h in entry.highlight_lines()]
    return items[:MAX_SATELLITES]
