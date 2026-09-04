"""服务端高保真 PDF 简历生成器 (ReportLab)。

不依赖浏览器 DOM / html2canvas / html2pdf 截屏，完全基于数据直接生成高清标准 A4 PDF。
支持原简历内容与 AI 优化版履历切换，支持多模板样式（极简纯白、典雅酒红、极客风尚、清新蓝灰、沉稳双栏）。
"""
import io
import logging
import re
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

logger = logging.getLogger(__name__)

# 注册中文字体（ReportLab 内置 CID 字体，全平台免部署外部 ttf）
try:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    FONT_NAME = "STSong-Light"
except Exception as e:
    logger.warning("STSong-Light 字体注册失败，回退到 Helvetica: %s", e)
    FONT_NAME = "Helvetica"

# 模板颜色主题映射
TEMPLATE_COLORS = {
    "minimal": {"primary": "#0f172a", "secondary": "#475569", "bg": "#f8fafc", "border": "#cbd5e1"},
    "twocolumn": {"primary": "#0f2942", "secondary": "#334155", "bg": "#f1f5f9", "border": "#94a3b8"},
    "burgundy": {"primary": "#8B1A1A", "secondary": "#7f1d1d", "bg": "#fff1f2", "border": "#fecdd3"},
    "geek": {"primary": "#1e293b", "secondary": "#0f172a", "bg": "#f8fafc", "border": "#e2e8f0"},
    "bluegrey": {"primary": "#334E68", "secondary": "#475569", "bg": "#f0f4f8", "border": "#bccadc"},
}


def _clean_str(val: Any) -> str:
    if val is None:
        return ""
    if not isinstance(val, str):
        val = str(val)
    # 过滤控制字符与特殊空白
    val = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF\uFFFD]", "", val)
    val = re.sub(r"\s+", " ", val).strip()
    return val


def _get_bullet_text(b: Any, source: str = "original") -> str:
    if not b:
        return ""
    if isinstance(b, str):
        return _clean_str(b)
    if not isinstance(b, dict):
        return _clean_str(b)

    if source == "original":
        return _clean_str(b.get("originalText") or b.get("raw_text") or b.get("text") or b.get("optimizedText") or "")
    return _clean_str(b.get("optimizedText") or b.get("originalText") or b.get("raw_text") or b.get("text") or "")


def generate_pdf_from_analysis(
    analysis_data: Dict[str, Any],
    source: str = "original",
    template: str = "minimal",
) -> bytes:
    """根据解析数据与优化数据服务端直接绘制高清 PDF。"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    theme = TEMPLATE_COLORS.get(template, TEMPLATE_COLORS["minimal"])
    primary_color = colors.HexColor(theme["primary"])
    secondary_color = colors.HexColor(theme["secondary"])

    root = analysis_data.get("result_json") or analysis_data or {}
    parsed_struct = analysis_data.get("parsed_structure") or root.get("parsed_structure") or {}
    profile = {**(root.get("profile") or {}), **(parsed_struct.get("profile") or {})}

    # 1. 候选人基础信息
    raw_name = _clean_str(parsed_struct.get("profile", {}).get("name") or parsed_struct.get("name") or profile.get("name") or root.get("name"))
    if not raw_name or raw_name in ["aa", "XXX", "候选人", "基本信息", "个人信息"]:
        raw_name = "求职者简历"
    name = raw_name

    phone = _clean_str(parsed_struct.get("profile", {}).get("phone") or parsed_struct.get("phone") or profile.get("phone"))
    email = _clean_str(parsed_struct.get("profile", {}).get("email") or parsed_struct.get("email") or profile.get("email"))
    location = _clean_str(parsed_struct.get("profile", {}).get("location") or parsed_struct.get("location") or profile.get("location") or profile.get("city"))
    exp_years = _clean_str(parsed_struct.get("profile", {}).get("years") or parsed_struct.get("experience_years") or profile.get("experience_years") or profile.get("years"))
    gender = _clean_str(parsed_struct.get("profile", {}).get("gender") or parsed_struct.get("gender") or profile.get("gender"))
    age = _clean_str(parsed_struct.get("profile", {}).get("age") or parsed_struct.get("age") or profile.get("age"))
    github = _clean_str(profile.get("github") or profile.get("blog") or parsed_struct.get("github"))

    # 2. 段落选择 (原文 vs AI 优化版)
    orig_summary = _clean_str(parsed_struct.get("summary") or profile.get("summary"))
    opt_summary = _clean_str(root.get("summary"))
    summary = (orig_summary or opt_summary) if source == "original" else (opt_summary or orig_summary)

    orig_work_exps = parsed_struct.get("work_experiences") or parsed_struct.get("work_history") or []
    opt_work_exps = root.get("work_experiences") or []
    work_exps = (orig_work_exps if len(orig_work_exps) > 0 else opt_work_exps) if source == "original" else (opt_work_exps if len(opt_work_exps) > 0 else orig_work_exps)

    orig_projects = parsed_struct.get("projects") or parsed_struct.get("personal_projects") or []
    opt_projects = root.get("projects") or root.get("personal_projects") or []
    projects = (orig_projects if len(orig_projects) > 0 else opt_projects) if source == "original" else (opt_projects if len(opt_projects) > 0 else orig_projects)

    education = parsed_struct.get("education") or parsed_struct.get("education_history") or root.get("education") or root.get("education_history") or profile.get("education") or []
    raw_skills = parsed_struct.get("skills") or parsed_struct.get("technical_skills") or root.get("skills") or root.get("technical_skills") or profile.get("skills") or []
    
    skills_list: List[str] = []
    if isinstance(raw_skills, list):
        skills_list = [_clean_str(s.get("name") if isinstance(s, dict) else s) for s in raw_skills if s]
    elif isinstance(raw_skills, str) and raw_skills.strip():
        skills_list = [_clean_str(s) for s in re.split(r"[,;\n\s]+", raw_skills) if s.strip()]

    # 定义样式
    name_style = ParagraphStyle(
        "DocName",
        fontName=FONT_NAME,
        fontSize=20,
        leading=24,
        textColor=primary_color,
        fontStyle="bold",
    )
    meta_style = ParagraphStyle(
        "DocMeta",
        fontName=FONT_NAME,
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#475569"),
    )
    section_title_style = ParagraphStyle(
        "SectionTitle",
        fontName=FONT_NAME,
        fontSize=12,
        leading=16,
        textColor=primary_color,
        spaceBefore=10,
        spaceAfter=4,
    )
    body_bold = ParagraphStyle(
        "BodyBold",
        fontName=FONT_NAME,
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#0f172a"),
    )
    body_text = ParagraphStyle(
        "BodyText",
        fontName=FONT_NAME,
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#334155"),
    )
    bullet_style = ParagraphStyle(
        "BulletText",
        fontName=FONT_NAME,
        fontSize=9.5,
        leading=14,
        leftIndent=12,
        firstLineIndent=-12,
        textColor=colors.HexColor("#334155"),
    )

    story: List[Any] = []

    # --- Header ---
    story.append(Paragraph(f"<b>{name}</b>", name_style))
    story.append(Spacer(1, 4))

    meta_parts = [gender, f"{age}岁" if age else "", f"{exp_years}经验" if exp_years else "", location, phone, email, github]
    meta_str = " &nbsp;|&nbsp; ".join([p for p in meta_parts if p])
    if meta_str:
        story.append(Paragraph(meta_str, meta_style))
        story.append(Spacer(1, 6))

    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceBefore=4, spaceAfter=8))

    # --- 个人总结 ---
    if summary:
        story.append(Paragraph("<b>个人总结 / 综合优势</b>", section_title_style))
        story.append(Paragraph(summary, body_text))
        story.append(Spacer(1, 8))

    # --- 教育背景 ---
    if education:
        story.append(Paragraph("<b>教育背景</b>", section_title_style))
        for e in education:
            if isinstance(e, str):
                story.append(Paragraph(f"• {_clean_str(e)}", body_text))
            elif isinstance(e, dict):
                school = _clean_str(e.get("school"))
                major = _clean_str(e.get("major"))
                degree = _clean_str(e.get("degree"))
                period = _clean_str(e.get("year") or e.get("time_range") or e.get("duration") or e.get("period"))
                honours = _clean_str(" | ".join([f"GPA: {e.get('gpa')}" if e.get("gpa") else "", _clean_str(e.get("rank")), _clean_str(e.get("awards"))]).strip(" | "))
                
                header_line = f"<b>{school}</b>"
                if major:
                    header_line += f" &nbsp;|&nbsp; {major}"
                if degree:
                    header_line += f" ({degree})"
                if period:
                    header_line += f" <font color='#64748b'>({period})</font>"
                
                story.append(Paragraph(header_line, body_bold))
                if honours:
                    story.append(Paragraph(f"<font color='#475569'>{honours}</font>", body_text))
            story.append(Spacer(1, 3))
        story.append(Spacer(1, 6))

    # --- 实习与工作经历 ---
    if work_exps:
        story.append(Paragraph("<b>实习与工作经历</b>", section_title_style))
        for w in work_exps:
            company = _clean_str(w.get("company"))
            role = _clean_str(w.get("role"))
            period = _clean_str(w.get("time_range") or w.get("duration"))
            
            line = f"<b>{company}</b>"
            if role:
                line += f" &nbsp;|&nbsp; {role}"
            if period:
                line += f" <font color='#64748b'>({period})</font>"
            
            story.append(Paragraph(line, body_bold))
            bullets = w.get("bullets") or []
            for b in bullets:
                txt = _get_bullet_text(b, source=source)
                if txt:
                    story.append(Paragraph(f"• {txt}", bullet_style))
            story.append(Spacer(1, 5))
        story.append(Spacer(1, 6))

    # --- 核心项目经历 ---
    if projects:
        story.append(Paragraph("<b>核心项目经历</b>", section_title_style))
        for p in projects:
            p_name = _clean_str(p.get("name") or p.get("title"))
            p_role = _clean_str(p.get("role"))
            p_period = _clean_str(p.get("duration") or p.get("time"))
            tech_stack = _clean_str(p.get("tech_stack"))

            line = f"<b>{p_name}</b>"
            if p_role:
                line += f" &nbsp;({p_role})"
            if p_period:
                line += f" <font color='#64748b'>[{p_period}]</font>"
            
            story.append(Paragraph(line, body_bold))
            if tech_stack:
                story.append(Paragraph(f"<font color='#475569'><b>技术栈:</b> {tech_stack}</font>", body_text))

            bullets = p.get("bullets") or p.get("details") or []
            if isinstance(bullets, list):
                for b in bullets:
                    txt = _get_bullet_text(b, source=source)
                    if txt:
                        story.append(Paragraph(f"• {txt}", bullet_style))
            story.append(Spacer(1, 5))
        story.append(Spacer(1, 6))

    # --- 专业技能 ---
    if skills_list:
        story.append(Paragraph("<b>专业技能</b>", section_title_style))
        skills_str = " &nbsp;•&nbsp; ".join(skills_list)
        story.append(Paragraph(skills_str, body_text))

    doc.build(story)
    pdf_bytes = buf.getvalue()
    logger.info("[pdf_resume_writer] PDF 生成成功: %d bytes (source=%s, template=%s)", len(pdf_bytes), source, template)
    return pdf_bytes
