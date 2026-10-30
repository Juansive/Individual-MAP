"""完整度检查规则。"""
from app.completeness import check_entry
from app.models import Attachment, Entry, Skill


def test_bare_entry_lists_basic_gaps():
    issues = check_entry(Entry(kind="award", title="某奖项"))
    assert issues == ["缺时间", "缺机构", "缺描述", "缺证明文件"]


def test_complete_award_has_no_issues():
    entry = Entry(kind="award", title="国家奖学金", org="XX大学", start="2024-10", description="前 5%")
    entry.attachments = [Attachment(original_name="证书.png", stored_path="x", sha256="1")]
    assert check_entry(entry) == []


def test_project_needs_numbers_and_skills():
    entry = Entry(kind="project", title="小程序", org="XX大学", start="2023-03",
                  description="课程设计", highlights="完成前后端开发")
    assert check_entry(entry) == ["成果未量化", "缺技能标签"]

    entry.highlights = "上线两周注册 800+ 用户"
    entry.skills = [Skill(name="Python")]
    assert check_entry(entry) == []


def test_other_kind_does_not_require_org():
    entry = Entry(kind="other", title="随手记", start="2024-01", description="…")
    assert check_entry(entry) == []
