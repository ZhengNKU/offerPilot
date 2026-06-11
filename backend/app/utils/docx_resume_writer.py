"""就地改写 DOCX 简历的 bullet 文字，保留所有 run 样式。

设计目标：用户上传 DOCX 后，下载下来的 AI 优化版应该和原 DOCX 看起来
完全一样（字体/颜色/图标/分栏/表格全保留），只有 bullet 文字被替换。

实现策略：
1. 用 python-docx 打开原 DOCX
2. 遍历 doc.paragraphs + 表格里所有 cell 的 paragraphs
3. 从 analysis_data.work_experiences 收集 (originalText, optimizedText) 配对
4. 段落的 text.strip() 与 originalText.strip() 完全相等时，
   把 para.runs[0].text 改成 optimizedText，其他 run 清空（保留格式属性）
5. 统计替换率，< MATCH_RATE_THRESHOLD 时抛 BulletMatchError 让上层回退到
   统一模板 PDF 渲染路径（PDF 转 DOCX 后段落错乱时走兜底）

不在 bullets 列表里的段落（公司名/岗位名/时间/小标题）一律不动。
"""
import io
import logging
from typing import Any, Dict, List, Tuple

from docx import Document
from docx.oxml.ns import qn

logger = logging.getLogger(__name__)

# 替换率 < 80% 视为识别失败，触发 PDF 兜底
MATCH_RATE_THRESHOLD = 0.8


class BulletMatchError(Exception):
    """bullet 段落识别率不足，上层应回退到 PDF 渲染路径。"""


def _iter_all_paragraphs(doc):
    """遍历 doc.paragraphs + 所有表格（含嵌套表格）里 cell 的 paragraphs。"""
    yield from doc.paragraphs
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs
                for nested in cell.tables:
                    for nr in nested.rows:
                        for nc in nr.cells:
                            yield from nc.paragraphs


def _replace_paragraph_text(para, new_text: str) -> None:
    """把段落里所有 run 的文字合并到第一个 run 上，保留第一个 run 的样式。

    视觉效果：颜色/字号/字体来自第一个 run（通常是 bullet 主样式）。
    其他 run 的文字清空但其 run 属性（rPr）保留 → Word 不会因空 run 报错。
    并且显式将中文字体（w:eastAsia）设为“微软雅黑”，防止在特定字体环境（如纯英文或日文转换环境）下部分中文字符显示为 □。
    """
    if not para.runs:
        run = para.add_run(new_text)
        rPr = run._r.get_or_add_rPr()
        rFonts = rPr.get_or_add_rFonts()
        rFonts.set(qn('w:eastAsia'), '微软雅黑')
        return
        
    run = para.runs[0]
    run.text = new_text
    
    # 强制东亚文字使用“微软雅黑”进行渲染，彻底修复特定汉字变豆腐块(□)的Bug
    rPr = run._r.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn('w:eastAsia'), '微软雅黑')
    
    for r in para.runs[1:]:
        r.text = ""


def _collect_bullets(analysis_data: Dict[str, Any]) -> List[Tuple[str, str]]:
    """从 analysis_data.work_experiences 抽出 (original, optimized) 配对。

    过滤规则：
    - 缺 originalText / optimizedText 的跳过（保持原文不被错误清空）
    - optimizedText 与 originalText 一字不差（LLM 偷懒或本就 OK）的跳过，
      避免无意义的"替换"
    """
    pairs: List[Tuple[str, str]] = []
    for exp in analysis_data.get("work_experiences") or []:
        for bullet in exp.get("bullets") or []:
            if not isinstance(bullet, dict):
                continue
            orig = (bullet.get("originalText") or "").strip()
            opt = (bullet.get("optimizedText") or "").strip()
            if not orig or not opt or opt == orig:
                continue
            pairs.append((orig, opt))
    return pairs


def _delete_paragraph(paragraph) -> None:
    """从文档中彻底删除指定段落的 XML 元素，避免在合并多段落时在 Word 中留下空白空行。"""
    p = paragraph._element
    if p is not None and p.getparent() is not None:
        p.getparent().remove(p)


def rewrite_resume_docx(content_bytes: bytes, analysis_data: Dict[str, Any]) -> bytes:
    """把 DOCX 里 bullet 段落的文字就地替换为 optimizedText，保留所有 run 样式。

    支持对单段匹配和换行分割的多段合并匹配，并在合并后删除多余的空段落。
    """
    pairs = _collect_bullets(analysis_data)
    if not pairs:
        raise BulletMatchError("analysis_data 中没有可替换的 bullet 配对")

    doc = Document(io.BytesIO(content_bytes))
    pending = list(pairs)
    replaced_count = 0

    all_paras = list(_iter_all_paragraphs(doc))
    p_idx = 0
    total_paras = len(all_paras)

    # 标记已被合并删除的段落元素，避免重复访问或修改
    deleted_elements = set()

    while p_idx < total_paras and pending:
        para = all_paras[p_idx]
        if para._element in deleted_elements:
            p_idx += 1
            continue

        para_text = para.text.strip()
        if not para_text:
            p_idx += 1
            continue

        matched = False
        for i, (orig, opt) in enumerate(pending):
            # 1. 尝试单段完全匹配
            if orig == para_text:
                _replace_paragraph_text(para, opt)
                pending.pop(i)
                replaced_count += 1
                p_idx += 1
                matched = True
                break

            # 2. 尝试多段合并匹配（解决由于 PDF 转换或换行导致的段落截断问题）
            if orig.startswith(para_text):
                accumulated_text = para_text
                match_paras = [para]
                next_idx = p_idx + 1
                
                while next_idx < total_paras and len(accumulated_text) < len(orig):
                    next_para = all_paras[next_idx]
                    if next_para._element in deleted_elements:
                        next_idx += 1
                        continue
                    next_text = next_para.text.strip()
                    if not next_text:
                        next_idx += 1
                        continue
                    
                    combined_direct = accumulated_text + next_text
                    combined_space = accumulated_text + " " + next_text
                    
                    if orig.startswith(combined_direct):
                        accumulated_text = combined_direct
                        match_paras.append(next_para)
                        next_idx += 1
                    elif orig.startswith(combined_space):
                        accumulated_text = combined_space
                        match_paras.append(next_para)
                        next_idx += 1
                    else:
                        break
                
                if accumulated_text == orig:
                    # 匹配成功！将优化后的文本填入首个段落，并删除后续的多余段落
                    _replace_paragraph_text(match_paras[0], opt)
                    for extra_para in match_paras[1:]:
                        _delete_paragraph(extra_para)
                        deleted_elements.add(extra_para._element)
                    
                    pending.pop(i)
                    replaced_count += 1
                    p_idx = next_idx
                    matched = True
                    break
        
        if not matched:
            p_idx += 1

    match_rate = replaced_count / len(pairs)
    if match_rate < MATCH_RATE_THRESHOLD:
        raise BulletMatchError(
            f"bullet 识别率 {match_rate:.1%} ({replaced_count}/{len(pairs)}) "
            f"低于阈值 {MATCH_RATE_THRESHOLD:.0%}"
        )

    logger.info(
        "[docx_writer] replaced %d/%d bullets (%.1f%%)",
        replaced_count, len(pairs), match_rate * 100,
    )

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
