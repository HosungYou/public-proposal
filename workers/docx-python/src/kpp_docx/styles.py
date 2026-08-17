"""Governed Word style and paragraph formatting helpers."""

from __future__ import annotations

from dataclasses import dataclass

from docx.document import Document as DocumentType
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.text.run import Run


@dataclass(frozen=True)
class TypographyContract:
    """Locked typography values expressed in both human and OOXML units."""

    heading_font: str
    navigation_font: str
    body_font: str
    body_point: float
    line_height: float
    character_spacing_pt: float

    @property
    def body_half_points(self) -> int:
        return round(self.body_point * 2)

    @property
    def body_line_dxa(self) -> int:
        # With lineRule=auto, 240 units are one line.
        return round(self.line_height * 240)

    @property
    def character_spacing_twips(self) -> int:
        return round(self.character_spacing_pt * 20)


def install_governed_styles(
    document: DocumentType,
    contract: TypographyContract,
) -> dict[str, str]:
    """Install named KPP styles without relying on Word's generic table styles."""

    _configure_style(
        document,
        "Normal",
        font=contract.body_font,
        half_points=contract.body_half_points,
        character_spacing_twips=contract.character_spacing_twips,
        create=False,
    )
    _configure_style(
        document,
        "KPP Body",
        font=contract.body_font,
        half_points=contract.body_half_points,
        character_spacing_twips=contract.character_spacing_twips,
    )
    _configure_style(
        document,
        "KPP Heading 1",
        font=contract.heading_font,
        half_points=32,
        bold=True,
    )
    _configure_style(
        document,
        "KPP Navigation",
        font=contract.navigation_font,
        half_points=18,
        bold=True,
    )
    _configure_style(
        document,
        "KPP Caption",
        font=contract.heading_font,
        half_points=18,
        bold=True,
    )
    _configure_style(
        document,
        "KPP Table Header",
        font=contract.heading_font,
        half_points=18,
        bold=True,
    )
    _configure_style(
        document,
        "KPP Table Body",
        font=contract.body_font,
        half_points=18,
        character_spacing_twips=contract.character_spacing_twips,
    )
    return {
        "body": "KPP Body",
        "heading": "KPP Heading 1",
        "navigation": "KPP Navigation",
        "caption": "KPP Caption",
        "tableHeader": "KPP Table Header",
        "tableBody": "KPP Table Body",
    }


def format_body_paragraph(paragraph: Paragraph, contract: TypographyContract) -> None:
    """Apply the body contract directly so document inspection does not infer styles."""

    paragraph.style = "KPP Body"
    paragraph_properties = paragraph._p.get_or_add_pPr()
    _replace_child(paragraph_properties, "jc", {"val": "both"})
    _replace_child(
        paragraph_properties,
        "spacing",
        {"line": str(contract.body_line_dxa), "lineRule": "auto"},
    )
    for run in paragraph.runs:
        format_run(
            run,
            font=contract.body_font,
            half_points=contract.body_half_points,
            character_spacing_twips=contract.character_spacing_twips,
        )


def format_navigation_paragraph(
    paragraph: Paragraph,
    contract: TypographyContract,
) -> None:
    """Apply the navigation font to retained template headers and footers."""

    paragraph.style = "KPP Navigation"
    for run in paragraph.runs:
        format_run(
            run,
            font=contract.navigation_font,
            half_points=18,
            bold=True,
        )


def format_run(
    run: Run,
    *,
    font: str,
    half_points: int,
    character_spacing_twips: int | None = None,
    bold: bool | None = None,
) -> None:
    """Write all script font slots to prevent undeclared Korean font fallback."""

    run_properties = run._r.get_or_add_rPr()
    _replace_child(
        run_properties,
        "rFonts",
        {"ascii": font, "hAnsi": font, "eastAsia": font, "cs": font},
    )
    _replace_child(run_properties, "sz", {"val": str(half_points)})
    _replace_child(run_properties, "szCs", {"val": str(half_points)})
    if character_spacing_twips is not None:
        _replace_child(
            run_properties,
            "spacing",
            {"val": str(character_spacing_twips)},
        )
    if bold is not None:
        _replace_child(run_properties, "b", {} if bold else {"val": "0"})


def _configure_style(
    document: DocumentType,
    name: str,
    *,
    font: str,
    half_points: int,
    character_spacing_twips: int | None = None,
    bold: bool = False,
    create: bool = True,
) -> None:
    styles = document.styles
    if name in styles:
        style = styles[name]
    elif create:
        style = styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    else:  # pragma: no cover - every valid Word document has Normal
        raise ValueError(f"required base style is missing: {name}")

    run_properties = style.element.get_or_add_rPr()
    _replace_child(
        run_properties,
        "rFonts",
        {"ascii": font, "hAnsi": font, "eastAsia": font, "cs": font},
    )
    _replace_child(run_properties, "sz", {"val": str(half_points)})
    _replace_child(run_properties, "szCs", {"val": str(half_points)})
    if character_spacing_twips is not None:
        _replace_child(
            run_properties,
            "spacing",
            {"val": str(character_spacing_twips)},
        )
    if bold:
        _replace_child(run_properties, "b", {})


def _replace_child(parent: object, local_name: str, attributes: dict[str, str]) -> None:
    existing = parent.find(qn(f"w:{local_name}"))
    if existing is not None:
        parent.remove(existing)
    child = OxmlElement(f"w:{local_name}")
    for name, value in attributes.items():
        child.set(qn(f"w:{name}"), value)
    parent.append(child)
