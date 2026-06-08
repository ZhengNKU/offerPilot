import io
from pypdf import PdfReader
import docx

def extract_text_from_pdf(content_bytes: bytes) -> str:
    pdf_file = io.BytesIO(content_bytes)
    reader = PdfReader(pdf_file)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

def extract_text_from_docx(content_bytes: bytes) -> str:
    docx_file = io.BytesIO(content_bytes)
    doc = docx.Document(docx_file)
    text = ""
    for para in doc.paragraphs:
        if para.text:
            text += para.text + "\n"
    for table in doc.tables:
        for row in table.rows:
            row_text = [cell.text for cell in row.cells if cell.text]
            if row_text:
                text += " | ".join(row_text) + "\n"
    return text

def extract_resume_text(content_bytes: bytes, filename: str) -> str:
    ext = filename.split('.')[-1].lower() if '.' in filename else ""
    if ext == "pdf":
        return extract_text_from_pdf(content_bytes)
    elif ext == "docx":
        return extract_text_from_docx(content_bytes)
    else:
        raise ValueError("不支持的文件格式，仅支持 PDF 和 DOCX")
