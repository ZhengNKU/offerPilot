"""
职级映射工具：工作经验 → 预期职级、文字职级 → 数字职级。

来自 F:\match_algorithm.md 的规则。
"""

import re
from typing import Optional

# ── 工作经验 → 预期职级（P-number） ──
# 格式: (years_upper_bound, expected_grade)
_YEARS_TO_GRADE: list[tuple[float, int]] = [
    # fixed order：由低到高判定
    (1.0,  1),   # < 1 年
    (2.0,  2),   # 1-2 年
    (3.5,  3),   # 2-3.5 年
    (5.0,  4),   # 3.5-5 年
    (7.0,  5),   # 5-7 年
    (9.0,  6),   # 7-9 年
    (11.0, 7),   # 9-11 年
    (14.0, 8),   # 11-14 年
]
_DEFAULT_GRADE = 9  # >= 14 年


def parse_work_years(experience_years: Optional[str]) -> float:
    """
    将 experience_years 字符串解析为浮点年数。

    示例:
        "在校/应届"  → 0.0
        "< 1 年"     → 0.5
        "3年"        → 3.0
        "3.5年"      → 3.5
        "5-7年"      → 6.0  (取中位数)
        None         → 0.0
    """
    if not experience_years or not experience_years.strip():
        return 0.0

    s = experience_years.strip()

    # 在校/应届
    if "在校" in s or "应届" in s or "实习" in s:
        return 0.0

    # "< 1 年"
    if "<" in s:
        return 0.5

    # "5-7年" 这种范围
    range_match = re.match(r'([\d.]+)\s*[-~～到至]\s*([\d.]+)', s)
    if range_match:
        lo = float(range_match.group(1))
        hi = float(range_match.group(2))
        return round((lo + hi) / 2, 1)

    # 直接提取第一个数字
    num_match = re.search(r'([\d.]+)', s)
    if num_match:
        return float(num_match.group(1))

    return 0.0


def expected_grade_from_years(work_years: float) -> int:
    """根据工作年限映射预期职级。"""
    for upper, grade in _YEARS_TO_GRADE:
        if work_years < upper:
            return grade
    return _DEFAULT_GRADE


# ── 文字职级 → 数字职级 ──
_TEXT_GRADE_MAP: dict[str, int] = {
    "初级": 3,
    "中级": 4,
    "高级": 6,
    "资深": 7,
    "专家": 8,
    "架构师": 8,
    "主管": 6,
    "经理": 7,
    "总监": 8,
    "负责人": 7,
}


def parse_target_grade(target_grade: Optional[str]) -> int:
    """
    从 target_grade 字符串中提取数字职级。

    示例:
        "P6"       → 6
        "L7"       → 7
        "T3-1"     → 3
        "高级"     → 6
        "资深"     → 7
        "架构师"   → 8
        None/"高级" → 6 (default)

    规则:
        1. 提取字符串中的第一个数字 → 如果 >=1 且 <=20 则直接使用
        2. 否则文字映射
        3. 无法映射时默认 4
    """
    if not target_grade or not target_grade.strip():
        return 4  # 默认

    s = target_grade.strip()

    # 提取数字
    num_match = re.search(r'(\d+)', s)
    if num_match:
        val = int(num_match.group(1))
        if 1 <= val <= 20:
            return val

    # 文字映射
    for keyword, grade in _TEXT_GRADE_MAP.items():
        if keyword in s:
            return grade

    # fallback
    return 4
