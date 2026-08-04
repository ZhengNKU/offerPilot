"""DOCX → PDF 转换（LibreOffice headless）。

为什么用 LibreOffice 而不是 weasyprint / docx2pdf / Aspose：
  - weasyprint：要重新写 HTML+CSS 模板，等于放弃原排版
  - docx2pdf：要装 MS Word，仅 Windows / macOS
  - Aspose：商业授权贵
  - LibreOffice headless：开源自托管，转 DOCX→PDF 保真度最高（毕竟 LibreOffice
    和 MS Word 是同领域竞争对手，互相 conversion 兼容性最好）

部署: backend/Dockerfile 已 apt install libreoffice-writer (不带 calc/impress，体积可控)。

性能：首次启动 LibreOffice 大约 3-5s（cold start）；进程内复用 soffice 大约 0.5-1s/页。
本文件用每次 spawn soffice + --convert-to pdf,简单可靠,文档量不大够用。
高并发场景下一步可以常驻 soffice 进程走 socket 接口。
"""
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# soffice 命令位置。apt 包是 /usr/bin/soffice (Debian/Ubuntu)；
# 直接下二进制放到 /usr/local/bin/ 也行。
_SOFFICE_BIN = os.environ.get("SOFFICE_BIN", "/usr/bin/soffice")


def docx_to_pdf(content_bytes: bytes, timeout_s: int = 60) -> bytes:
    """把 DOCX 字节流转成 PDF 字节流。

    Args:
        content_bytes: DOCX 二进制
        timeout_s: soffice 进程最长存活时间。默认 60s,
                   单个 5-10 页简历实测 < 5s,留足余量

    Returns:
        PDF 二进制

    Raises:
        RuntimeError: soffice 未安装 / 转换失败 / 超时
    """
    in_path = out_dir = None
    try:
        # 写到临时文件 —— soffice --convert-to 需要文件路径,不能直接吃 stdin
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as in_f:
            in_f.write(content_bytes)
            in_path = in_f.name
        out_dir = tempfile.mkdtemp(prefix="docx2pdf_")

        # --headless: 无 GUI; --convert-to pdf: 输出格式; --outdir: 输出目录
        # --norestore --nologo --nofirststartwizard: 跳过 LibreOffice 启动时的
        #   恢复/欢迎弹窗(容器里没屏幕,弹窗会卡住进程)
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
            env={**os.environ, "HOME": tempfile.gettempdir()},  # 容器里 HOME 未设会 warn
        )
        elapsed = time.time() - t0

        if proc.returncode != 0:
            raise RuntimeError(
                f"soffice exit {proc.returncode} after {elapsed:.1f}s: "
                f"stderr={proc.stderr.decode('utf-8', errors='replace')[:300]}"
            )

        # soffice 输出文件名 = 输入 stem + .pdf
        pdf_path = Path(out_dir) / (Path(in_path).stem + ".pdf")
        if not pdf_path.exists():
            raise RuntimeError(
                f"soffice succeeded but PDF not found at {pdf_path} "
                f"(stdout={proc.stdout.decode('utf-8', errors='replace')[:200]})"
            )

        pdf_bytes = pdf_path.read_bytes()
        logger.info(
            "[docx_to_pdf] %d KB DOCX -> %d KB PDF in %.2fs",
            len(content_bytes) / 1024, len(pdf_bytes) / 1024, elapsed,
        )
        return pdf_bytes

    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"soffice timeout after {timeout_s}s") from e
    except FileNotFoundError as e:
        # soffice 未装 —— 给出明确错误,引导运维去装
        raise RuntimeError(
            f"soffice not found at {_SOFFICE_BIN}. "
            f"Install: apt-get install -y libreoffice-writer. "
            f"Or set SOFFICE_BIN env to point at the binary."
        ) from e
    finally:
        for p in (in_path,):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
        # out_dir 整个删掉(里面只有临时 PDF)
        if out_dir and os.path.isdir(out_dir):
            try:
                for f in os.listdir(out_dir):
                    os.unlink(os.path.join(out_dir, f))
                os.rmdir(out_dir)
            except OSError:
                pass