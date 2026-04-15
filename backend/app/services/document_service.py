"""Document parsing service for extracting text from docx, pdf, xlsx files."""
import io
from typing import Optional


class DocumentService:
    """Parse various document formats into plain text for knowledge extraction."""

    async def parse(self, content: bytes, filename: str, mime_type: Optional[str] = None) -> str:
        """Parse document content to plain text based on file extension."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext == "docx":
            return self._parse_docx(content)
        elif ext == "pdf":
            return self._parse_pdf(content)
        elif ext in ("xlsx", "xls"):
            return self._parse_xlsx(content)
        elif ext == "txt":
            return content.decode("utf-8", errors="replace")
        elif ext == "md":
            return content.decode("utf-8", errors="replace")
        else:
            raise ValueError(f"Unsupported file format: .{ext}. Supported: docx, pdf, xlsx, txt, md")

    def _parse_docx(self, content: bytes) -> str:
        """Extract text from Word document."""
        from docx import Document
        doc = Document(io.BytesIO(content))

        texts = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                # Preserve heading structure
                if para.style and para.style.name and para.style.name.startswith("Heading"):
                    level = para.style.name.replace("Heading ", "").replace("Heading", "1")
                    try:
                        level_num = int(level)
                    except ValueError:
                        level_num = 1
                    texts.append(f"\n{'#' * level_num} {text}\n")
                else:
                    texts.append(text)

        # Also extract from tables
        for table in doc.tables:
            rows_text = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    rows_text.append(" | ".join(cells))
            if rows_text:
                texts.append("\n[Table]\n" + "\n".join(rows_text) + "\n[/Table]\n")

        return "\n".join(texts)

    def _parse_pdf(self, content: bytes) -> str:
        """Extract text from PDF."""
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(content))

        texts = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                texts.append(f"--- Page {i+1} ---\n{text.strip()}")

        return "\n\n".join(texts)

    def _parse_xlsx(self, content: bytes) -> str:
        """Extract text from Excel spreadsheet."""
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)

        texts = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            sheet_rows = []
            for row in ws.iter_rows(values_only=True):
                cells = [str(cell) if cell is not None else "" for cell in row]
                if any(c.strip() for c in cells):
                    sheet_rows.append(" | ".join(cells))
            if sheet_rows:
                texts.append(f"\n## Sheet: {sheet_name}\n" + "\n".join(sheet_rows))

        wb.close()
        return "\n".join(texts)
