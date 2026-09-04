"""DOCX → PDF 转换（支持 Windows MS Word COM 与 Linux LibreOffice headless）。

保真度最高转换方案：
  - Windows 环境：优先使用 MS Word COM 接口直接导出 PDF（100% 还原布局、字体与像素点）
  - Linux 环境 / Docker 容器：使用 LibreOffice headless (--convert-to pdf) 转换
  - 双引擎回退兜底
"""
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_SOFFICE_BIN = os.environ.get("SOFFICE_BIN", "/usr/bin/soffice")


def _docx_to_pdf_win32(in_path: str, out_path: str) -> bool:
    """使用 Windows MS Word COM 组件高保真转 PDF。"""
    try:
        import win32com.client
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        doc = word.Documents.Open(in_path)
        doc.SaveAs(out_path, FileFormat=17)  # 17 = wdFormatPDF
        doc.Close()
        word.Quit()
        return os.path.exists(out_path) and os.path.getsize(out_path) > 0
    except Exception as e:
        logger.warning("[docx_to_pdf] Windows MS Word COM 转换失败: %s", e)
        return False


def _docx_to_pdf_libreoffice(in_path: str, out_dir: str, timeout_s: int = 60) -> Optional[str]:
    """使用 LibreOffice headless 转换。"""
    cmd = [
        _SOFFICE_BIN,
        "--headless",
        "--norestore",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to", "pdf",
        "--outdir", out_dir,
        in_path,
    ]
    t0 = time.time()
    proc = subprocess.run(
        cmd,
        capture_output=True,
        timeout=timeout_s,
        env={**os.environ, "HOME": tempfile.gettempdir()},
    )
    elapsed = time.time() - t0

    if proc.returncode != 0:
        logger.warning("[docx_to_pdf] soffice 退出码 %d: %s", proc.returncode, proc.stderr.decode("utf-8", errors="replace")[:200])
        return None

    pdf_path = Path(out_dir) / (Path(in_path).stem + ".pdf")
    if pdf_path.exists():
        logger.info("[docx_to_pdf] LibreOffice 转换成功: %.2fs", elapsed)
        return str(pdf_path)
    return None


def docx_to_pdf(content_bytes: bytes, timeout_s: int = 60) -> bytes:
    """把 DOCX 字节流转成 PDF 字节流。"""
    in_path = out_dir = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as in_f:
            in_f.write(content_bytes)
            in_path = in_f.name
        out_dir = tempfile.mkdtemp(prefix="docx2pdf_")
        target_pdf_path = os.path.join(out_dir, "output.pdf")

        # 1. Windows 环境优先走 MS Word COM（高保真）
        if os.name == "nt":
            if _docx_to_pdf_win32(in_path, target_pdf_path):
                return Path(target_pdf_path).read_bytes()

        # 2. Linux / Fallback 走 LibreOffice
        res_pdf = _docx_to_pdf_libreoffice(in_path, out_dir, timeout_s=timeout_s)
        if res_pdf and os.path.exists(res_pdf):
            return Path(res_pdf).read_bytes()

        raise RuntimeError("DOCX -> PDF 转换引擎不可用（请检查 MS Word 或 LibreOffice 环境）")
    finally:
        if in_path and os.path.exists(in_path):
            try:
                os.unlink(in_path)
            except OSError:
                pass
        if out_dir and os.path.isdir(out_dir):
            try:
                for f in os.listdir(out_dir):
                    os.unlink(os.path.join(out_dir, f))
                os.rmdir(out_dir)
            except OSError:
                pass