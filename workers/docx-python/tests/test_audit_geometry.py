from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from kpp_docx.audit_geometry import audit_docx_geometry


def test_audits_locked_typography_native_table_and_drawing_relationships(tmp_path: Path) -> None:
    docx = tmp_path / "proposal.docx"
    _write_docx(docx, valid=True)

    report = audit_docx_geometry(docx, expected_profile_sha256="1" * 64)

    assert report["status"] == "PASS"
    assert report["docx"]["sha256"] == hashlib.sha256(docx.read_bytes()).hexdigest()
    assert report["facts"] == {
        "bodyParagraphs": 1,
        "nativeTables": 1,
        "drawings": 1,
        "captions": 1,
    }
    assert report["embeddedMedia"] == [
        {
            "relationshipId": "rId1",
            "member": "word/media/image1.png",
            "sha256": hashlib.sha256(b"png").hexdigest(),
        }
    ]
    assert report["findings"] == []


def test_reports_malformed_docx_as_a_stable_blocker_instead_of_crashing(tmp_path: Path) -> None:
    docx = tmp_path / "broken.docx"
    docx.write_bytes(b"not-a-zip")

    report = audit_docx_geometry(docx, expected_profile_sha256="1" * 64)

    assert report["status"] == "BLOCKED"
    assert [finding["code"] for finding in report["findings"]] == [
        "KPP_DOCX_PACKAGE_INVALID"
    ]


def test_blocks_missing_table_geometry_and_unbound_drawing(tmp_path: Path) -> None:
    docx = tmp_path / "proposal.docx"
    _write_docx(docx, valid=False)

    report = audit_docx_geometry(docx, expected_profile_sha256="1" * 64)

    assert report["status"] == "BLOCKED"
    codes = {finding["code"] for finding in report["findings"]}
    assert "KPP_DOCX_TABLE_GEOMETRY" in codes
    assert "KPP_DOCX_DRAWING_RELATIONSHIP" in codes


def _write_docx(path: Path, *, valid: bool) -> None:
    document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
 <w:body>
  <w:p><w:pPr><w:pStyle w:val="KPPBody"/><w:jc w:val="both"/><w:spacing w:line="365" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Serif CJK KR" w:hAnsi="Noto Serif CJK KR" w:eastAsia="Noto Serif CJK KR" w:cs="Noto Serif CJK KR"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:spacing w:val="-4"/></w:rPr><w:t>연구 본문</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="KPPCaption"/></w:pPr><w:r><w:t>그림 1. 연구 프레임워크</w:t></w:r></w:p>
  <w:p><w:r><w:drawing><a:blip r:embed="{'rId1' if valid else 'rIdMissing'}"/></w:drawing></w:r></w:p>
  <w:tbl><w:tblPr>{'<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/></w:tblBorders>' if valid else ''}</w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>
  <w:sectPr/>
 </w:body>
</w:document>'''
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:style w:type="paragraph" w:styleId="KPPBody"><w:name w:val="KPP Body"/><w:rPr><w:rFonts w:ascii="Noto Serif CJK KR" w:hAnsi="Noto Serif CJK KR" w:eastAsia="Noto Serif CJK KR" w:cs="Noto Serif CJK KR"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:spacing w:val="-4"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="KPPHeading1"><w:rPr><w:rFonts w:ascii="Noto Sans CJK KR" w:hAnsi="Noto Sans CJK KR" w:eastAsia="Noto Sans CJK KR" w:cs="Noto Sans CJK KR"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="KPPNavigation"><w:rPr><w:rFonts w:ascii="Noto Sans CJK KR" w:hAnsi="Noto Sans CJK KR" w:eastAsia="Noto Sans CJK KR" w:cs="Noto Sans CJK KR"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="KPPCaption"><w:name w:val="KPP Caption"/><w:rPr><w:rFonts w:ascii="Noto Sans CJK KR" w:hAnsi="Noto Sans CJK KR" w:eastAsia="Noto Sans CJK KR" w:cs="Noto Sans CJK KR"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="KPPTableHeader"><w:rPr><w:rFonts w:ascii="Noto Sans CJK KR" w:hAnsi="Noto Sans CJK KR" w:eastAsia="Noto Sans CJK KR" w:cs="Noto Sans CJK KR"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="KPPTableBody"><w:rPr><w:rFonts w:ascii="Noto Serif CJK KR" w:hAnsi="Noto Serif CJK KR" w:eastAsia="Noto Serif CJK KR" w:cs="Noto Serif CJK KR"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:spacing w:val="-4"/></w:rPr></w:style>
</w:styles>'''
    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>'''
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/_rels/document.xml.rels", rels)
        archive.writestr("word/media/image1.png", b"png")
