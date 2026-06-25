"""
求职目标匹配度评分算法（5 维度加权）。

设计文档：F:\match_algorithm.md

5 个维度：
    1. 经验年限 vs 目标职级      (25%)
    2. 当前薪资 vs 目标薪资      (25%)
    3. 当前岗位 vs 目标岗位      (20%)
    4. 公司梯队跃迁              (15%)
    5. 教育 + 年龄 + 求职状态    (15%)

最终得分 clamp 到 [30, 97]。
"""

from __future__ import annotations

import re
import logging
from typing import Optional

from app.services.company_tiers import get_company_tier
from app.services.grade_mapping import (
    parse_work_years,
    expected_grade_from_years,
    parse_target_grade,
)

logger = logging.getLogger(__name__)


# ── 985/211/C9/双一流 高校关键词 ──
_ELITE_SCHOOL_KEYWORDS: set[str] = {
    "985", "211", "C9", "双一流", "985工程", "211工程",
}
# 985 高校名单（部分用于名称匹配）
_ELITE_SCHOOL_NAMES: set[str] = {
    "清华大学", "北京大学", "浙江大学", "复旦大学", "上海交通大学",
    "南京大学", "中国科学技术大学", "哈尔滨工业大学", "西安交通大学",
    "武汉大学", "华中科技大学", "中山大学", "四川大学", "南开大学",
    "天津大学", "山东大学", "中南大学", "厦门大学", "东南大学",
    "同济大学", "北京航空航天大学", "北京理工大学", "中国农业大学",
    "华东师范大学", "大连理工大学", "电子科技大学", "华南理工大学",
    "湖南大学", "重庆大学", "西北工业大学", "兰州大学", "东北大学",
    "吉林大学", "中国人民大学", "北京师范大学", "国防科技大学",
    "中央民族大学", "中国海洋大学", "西北农林科技大学",
    # 常见简称
    "清华", "北大", "浙大", "复旦", "上交", "上海交大", "南大",
    "中科大", "哈工大", "西交", "西安交大", "武大", "华科",
    "中山", "川大", "南开", "天大", "山大", "中南",
    "厦大", "东南", "同济", "北航", "北理", "中国农大",
    "华师", "大工", "成电", "华工", "湖大", "重大",
    "西工大", "兰大", "东大", "吉大", "人大", "北师大",
    "国科大", "中科院",
    # 海外/港澳知名高校
    "MIT", "Stanford", "Harvard", "Oxford", "Cambridge",
    "CMU", "UC Berkeley", "Caltech", "Princeton", "Yale",
    "ETH", "NUS", "NTU", "东京大学", "香港大学", "香港中文大学",
    "香港科技大学", "港大", "港中文", "港科大",
}


def _is_elite_school(school: Optional[str]) -> bool:
    """判断是否为 985/211/C9/双一流/世界名校。"""
    if not school or not school.strip():
        return False
    s = school.strip()

    # 关键词匹配
    for kw in _ELITE_SCHOOL_KEYWORDS:
        if kw in s:
            return True

    # 名单匹配
    for name in _ELITE_SCHOOL_NAMES:
        if name in s:
            return True

    # 包含"双一流"、"985"等的全称
    return False


# ── Jaccard 相似度 ──

def _tokenize(text: str) -> set[str]:
    """中英文混合分词：中文按 2-gram，英文按空格切词。"""
    tokens: set[str] = set()
    if not text:
        return tokens

    # 英文单词
    eng_words = re.findall(r'[a-zA-Z]+', text)
    for w in eng_words:
        tokens.add(w.lower())

    # 中文 2-gram（保留中文字符）
    chinese = ''.join(re.findall(r'[一-鿿㐀-䶿]', text))
    for i in range(len(chinese) - 1):
        tokens.add(chinese[i:i + 2])
    # 单个汉字也纳入（处理单字角色名）
    for ch in chinese:
        tokens.add(ch)

    return tokens


def _jaccard_similarity(a: str, b: str) -> float:
    """Jaccard 相似度：|A ∩ B| / |A ∪ B|"""
    set_a = _tokenize(a)
    set_b = _tokenize(b)
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    if union == 0:
        return 0.0
    return intersection / union


# ── 各维度评分 ──

def _dim1_experience_vs_grade(
    experience_years: Optional[str],
    target_grade: Optional[str],
) -> float:
    """
    维度 1：经验年限 vs 目标职级（权重 0.25）。

    步骤：
        1. 解析 experience_years → 工作年数
        2. 映射工作年数 → 预期职级
        3. 解析 target_grade → 数字职级
        4. gap = target_grade - expected_grade → 查表给分
    """
    work_years = parse_work_years(experience_years)
    expected_grade = expected_grade_from_years(work_years)
    target_grade_num = parse_target_grade(target_grade)

    gap = target_grade_num - expected_grade

    if gap <= 0:
        score = 95  # 年限充足
    elif gap == 1:
        score = 75  # 稍高，略有挑战
    elif gap == 2:
        score = 50  # 有一定跨度
    elif gap == 3:
        score = 30  # 跨度较大
    else:
        score = 15  # 跨度太大

    logger.debug(
        "dim1: work_years=%.1f expected_grade=%d target_grade=%d gap=%d score=%.0f",
        work_years, expected_grade, target_grade_num, gap, score,
    )
    return score


def _dim2_salary_vs_target(
    salary_min: Optional[int],
    salary_max: Optional[int],
    target_salary_min: Optional[int],
    target_salary_max: Optional[int],
) -> float:
    """
    维度 2：当前薪资 vs 目标薪资（权重 0.25）。

    步骤：
        1. 计算当前薪资中位数 current_mid
        2. 计算目标薪资中位数 target_mid
        3. increase = (target_mid / current_mid - 1) * 100
        4. 查表给分
    """
    if (not salary_min or not salary_max or
            not target_salary_min or not target_salary_max):
        # 缺少薪资数据 → 给中等分
        return 70.0

    if salary_min <= 0 or salary_max <= 0:
        return 70.0

    current_mid = (salary_min + salary_max) / 2.0
    target_mid = (target_salary_min + target_salary_max) / 2.0

    if current_mid <= 0:
        return 70.0

    increase = (target_mid / current_mid - 1.0) * 100.0

    if increase <= 5:
        score = 60   # 几乎没涨，动力不足
    elif increase <= 15:
        score = 85   # 保守涨幅，匹配度高
    elif increase <= 30:
        score = 95   # 最佳跳槽区间
    elif increase <= 50:
        score = 80   # 略高但可行
    elif increase <= 70:
        score = 55   # 偏高
    elif increase <= 100:
        score = 35   # 太高
    else:
        score = 20   # 翻倍以上，不现实

    logger.debug(
        "dim2: current_mid=%.0f target_mid=%.0f increase=%.1f%% score=%.0f",
        current_mid, target_mid, increase, score,
    )
    return score


def _dim3_role_similarity(
    role_name: Optional[str],
    target_role: Optional[str],
) -> float:
    """
    维度 3：当前岗位 vs 目标岗位（权重 0.20）。

    步骤：
        1. 若 current_role 包含 target_role（子串）→ 90 分
        2. 否则计算 Jaccard 相似度
        3. 查表给分
    """
    current = (role_name or "").strip()
    target = (target_role or "").strip()

    if not current or not target:
        return 50.0  # 缺少数据，中位分

    # 子串包含
    if target.lower() in current.lower() or current.lower() in target.lower():
        return 90.0

    sim = _jaccard_similarity(current, target)

    if sim >= 0.5:
        score = 90.0
    elif sim >= 0.3:
        score = 70.0
    elif sim >= 0.15:
        score = 50.0
    else:
        score = 30.0

    logger.debug("dim3: current='%s' target='%s' sim=%.3f score=%.0f", current, target, sim, score)
    return score


def _dim4_company_tier(
    company_name: Optional[str],
    target_company: Optional[str],
) -> float:
    """
    维度 4：公司梯队跃迁（权重 0.15）。

    步骤：
        1. 获取当前公司梯队
        2. 获取目标公司梯队
        3. gap = current_tier - target_tier
        4. 查表给分
    """
    current_tier = get_company_tier(company_name)
    target_tier = get_company_tier(target_company)

    gap = current_tier - target_tier  # 正值=升级，负值=降级

    if gap >= 2:
        score = 35   # 跳 2 级以上 → 跨度太大
    elif gap == 1:
        score = 65   # 跳 1 级 → 有挑战
    elif gap == 0:
        score = 85   # 同级 → 合理平级流动
    else:
        score = 95   # 降级 → 保守/求稳

    logger.debug(
        "dim4: current_tier=%d target_tier=%d gap=%d score=%.0f",
        current_tier, target_tier, gap, score,
    )
    return score


def _dim5_education_age_status(
    school: Optional[str],
    degree: Optional[str],
    age: int,
    job_status: str,
    target_grade: Optional[str],
) -> float:
    """
    维度 5：教育 + 年龄 + 求职状态（权重 0.15）。

    起始分 50，加分项和惩罚项叠加，最终 clamp 到 [5, 100]。
    """
    score = 50.0

    # ── 加分项 ──
    # 985/211 名校
    if _is_elite_school(school):
        score += 20
    elif school and school.strip():
        score += 5  # 有学校名但非名校

    # 学历
    degree_str = (degree or "").strip()
    if "博士" in degree_str:
        score += 15
    elif "硕士" in degree_str or "研究生" in degree_str:
        score += 10
    elif "本科" in degree_str or "学士" in degree_str or "大学" in degree_str:
        score += 5

    # 在职加分
    if job_status == "active":
        score += 8

    # ── 惩罚项 ──
    target_grade_num = parse_target_grade(target_grade)

    # 高阶 + 年轻
    if target_grade_num >= 7 and age < 25:
        score -= 15
    if target_grade_num >= 8 and age < 28:
        score -= 10

    # 低阶 + 高龄
    if target_grade_num <= 3 and age > 40:
        score -= 10

    # 离职
    if job_status == "resigned":
        score -= 5

    # clamp
    score = max(5.0, min(100.0, score))

    logger.debug("dim5: final_score=%.0f", score)
    return score


# ── 主入口 ──

# 权重常量
WEIGHT_1 = 0.25  # 经验 vs 职级
WEIGHT_2 = 0.25  # 薪资 vs 目标薪资
WEIGHT_3 = 0.20  # 岗位相似度
WEIGHT_4 = 0.15  # 公司梯队
WEIGHT_5 = 0.15  # 教育+年龄+状态


def compute_match_rate(
    *,
    experience_years: Optional[str] = None,
    target_grade: Optional[str] = None,
    salary_min: Optional[int] = None,
    salary_max: Optional[int] = None,
    target_salary_min: Optional[int] = None,
    target_salary_max: Optional[int] = None,
    role_name: Optional[str] = None,
    target_role: Optional[str] = None,
    company_name: Optional[str] = None,
    target_company: Optional[str] = None,
    school: Optional[str] = None,
    degree: Optional[str] = None,
    age: int = 25,
    job_status: str = "active",
) -> int:
    """
    计算求职目标匹配度，返回 [30, 97] 的整数。

    所有必需字段由 UserProfile 提供，以 keyword args 显式传入避免隐式耦合。
    """
    d1 = _dim1_experience_vs_grade(experience_years, target_grade)
    d2 = _dim2_salary_vs_target(salary_min, salary_max, target_salary_min, target_salary_max)
    d3 = _dim3_role_similarity(role_name, target_role)
    d4 = _dim4_company_tier(company_name, target_company)
    d5 = _dim5_education_age_status(school, degree, age, job_status, target_grade)

    raw = (
        d1 * WEIGHT_1
        + d2 * WEIGHT_2
        + d3 * WEIGHT_3
        + d4 * WEIGHT_4
        + d5 * WEIGHT_5
    )

    result = round(raw)
    result = max(30, min(97, result))

    logger.info(
        "match_rate raw=%.2f final=%d | "
        "d1=%.0f d2=%.0f d3=%.0f d4=%.0f d5=%.0f",
        raw, result, d1, d2, d3, d4, d5,
    )
    return result


def compute_match_rate_from_profile(profile) -> int:
    """
    便捷函数：直接从 UserProfile ORM 对象计算匹配度。

    调用 compute_match_rate(...)，解构 profile 字段为 keyword args。
    """
    return compute_match_rate(
        experience_years=profile.experience_years,
        target_grade=profile.target_grade,
        salary_min=profile.salary_min,
        salary_max=profile.salary_max,
        target_salary_min=profile.target_salary_min,
        target_salary_max=profile.target_salary_max,
        role_name=profile.role_name,
        target_role=profile.target_role,
        company_name=profile.company_name,
        target_company=profile.target_company,
        school=profile.school,
        degree=profile.degree,
        age=profile.age,
        job_status=profile.job_status,
    )
