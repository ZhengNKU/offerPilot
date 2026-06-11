"""把 PDF 简历转成可编辑的 DOCX。

使用 pdf2docx（基于 PyMuPDF），不需要 LibreOffice 等外部系统组件。
- 文字层 PDF：转换后保留段落/字体/表格的近似布局
- 扫描型 PDF（纯图片）：转换后段落为空 → 上层 bullet 匹配会失败，
  触发 BulletMatchError 让路由层回退到 PDF 渲染路径

实现细节：PyMuPDF 1.24+ 不再接受 file-like object，只接受路径或带文件名的对象。
所以我们用 tempfile.NamedTemporaryFile 中转，读完立即清理。
"""
import io
import logging
import tempfile
import os

logger = logging.getLogger(__name__)


def convert_pdf_to_docx(content_bytes: bytes) -> bytes:
    """把 PDF 字节流转成 DOCX 字节流。"""
    from pdf2docx import Converter

    in_path = None
    out_path = None
    try:
        # 输入 PDF 写到临时文件（PyMuPDF 1.24+ 要求路径或文件名）
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as in_f:
            in_f.write(content_bytes)
            in_path = in_f.name
        # 输出 DOCX 也用临时文件
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as out_f:
            out_path = out_f.name
        cv = Converter(in_path)
        try:
            cv.convert(out_path)
        finally:
            cv.close()
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        for p in (in_path, out_path):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass

