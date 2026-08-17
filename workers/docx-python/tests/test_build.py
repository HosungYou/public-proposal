"""Artifact-level tests for governed Word-native proposal builds."""

from __future__ import annotations

import hashlib
import json
import zipfile
from base64 import b64decode
from pathlib import Path

import pytest
from docx import Document
from pydantic import ValidationError

from kpp_docx.build import BuildRequest, build_document


WORKER_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = WORKER_ROOT / "assets" / "Korean Public Proposal A4 v1.docx"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _xml(path: Path, member: str) -> str:
    with zipfile.ZipFile(path) as archive:
        return archive.read(member).decode("utf-8")


def _canonical_sha(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def sample_request(tmp_path: Path) -> BuildRequest:
    return BuildRequest.model_validate(
        {
            "schemaVersion": "1.0.0",
            "projectId": "synthetic-research-proposal",
            "template": {
                "assetId": "korean-public-proposal-a4-v1",
                "path": str(TEMPLATE),
                "sha256": _sha256(TEMPLATE),
            },
            "pagePlan": {
                "schemaVersion": "1.0.0",
                "pages": [
                    {
                        "pageId": "P-01",
                        "requirementId": "REQ-01",
                        "pageRole": "research_method",
                        "surfaceTemplateId": "r08-research-method-v1",
                        "claimIds": ["CLM-01"],
                        "figureSpecs": [],
                    }
                ],
            },
            "evidenceLedger": {
                "schemaVersion": "1.0.0",
                "claims": [
                    {
                        "claimId": "CLM-01",
                        "status": "verified",
                        "evidenceIds": ["EV-01"],
                    }
                ],
                "bindings": [
                    {
                        "evidenceId": "EV-01",
                        "sourcePath": "/locked/source.pdf",
                        "sourceSha256": "a" * 64,
                        "scope": "연구 수행방법의 공식 근거",
                        "claimIds": ["CLM-01"],
                        "targetRequirementId": "REQ-01",
                        "targetPageId": "P-01",
                        "targetPageRole": "research_method",
                    }
                ],
            },
            "contentBlocks": [
                {
                    "pageId": "P-01",
                    "heading": "1. 연구 수행방법",
                    "paragraphs": [
                        {
                            "text": "공식 자료와 현장 검증을 연결하여 연구 결과의 활용 가능성을 높인다.",
                            "claimIds": ["CLM-01"],
                            "evidenceIds": ["EV-01"],
                        }
                    ],
                    "tables": [
                        {
                            "tableId": "TBL-01",
                            "caption": "표 1. 연구 단계별 산출물",
                            "headers": ["단계", "산출물"],
                            "rows": [["착수", "연구설계서"], ["분석", "중간보고서"]],
                            "columnWidthsDxa": [2400, 6000],
                        }
                    ],
                    "figureIds": [],
                }
            ],
            "figureManifest": {"schemaVersion": "1.0.0", "figures": []},
            "surfaceProfile": {
                "schemaVersion": "1.0.0",
                "profileId": "synthetic-korean-public-research-v1",
                "status": "locked",
                "typography": {
                    "headingFont": "Noto Sans CJK KR",
                    "navigationFont": "Noto Sans CJK KR",
                    "bodyFont": "Noto Serif CJK KR",
                    "bodyPoint": 9.3,
                    "lineHeight": 1.52,
                    "alignment": "justified",
                    "characterSpacingPt": -0.2,
                },
                "table": {
                    "widthDxa": 8400,
                    "cellMarginDxa": {"top": 80, "start": 100, "bottom": 80, "end": 100},
                    "borderSizeEighthPt": 4,
                },
            },
            "output": {
                "docxPath": str(tmp_path / "proposal.docx"),
                "manifestPath": str(tmp_path / "build-manifest.json"),
            },
        }
    )


def test_build_applies_body_and_table_contract(tmp_path: Path) -> None:
    result = build_document(sample_request(tmp_path))

    document_xml = _xml(result.docx, "word/document.xml")
    styles_xml = _xml(result.docx, "word/styles.xml")
    header_xml = _xml(result.docx, "word/header1.xml")

    assert 'w:jc w:val="both"' in document_xml
    assert 'w:spacing w:line="365" w:lineRule="auto"' in document_xml
    assert 'w:spacing w:val="-4"' in document_xml
    assert 'w:tblLayout w:type="fixed"' in document_xml
    assert 'w:gridCol w:w="2400"' in document_xml
    assert 'w:gridCol w:w="6000"' in document_xml
    assert "w:tblCellMar" in document_xml
    assert "TableGrid" not in document_xml
    assert "Noto Sans CJK KR" in styles_xml
    assert "Noto Serif CJK KR" in styles_xml
    assert 'w:sz w:val="19"' in styles_xml
    assert "Noto Sans CJK KR" in header_xml

    reopened = Document(result.docx)
    assert reopened.paragraphs[0].text == "1. 연구 수행방법"
    assert len(reopened.tables) == 1


def test_manifest_binds_template_inputs_pages_and_output_hashes(tmp_path: Path) -> None:
    request = sample_request(tmp_path)
    result = build_document(request)
    manifest = json.loads(result.manifest.read_text(encoding="utf-8"))

    assert manifest["schemaVersion"] == "1.0.0"
    assert manifest["projectId"] == request.project_id
    assert manifest["template"] == {
        "assetId": "korean-public-proposal-a4-v1",
        "path": str(TEMPLATE.resolve()),
        "sha256": _sha256(TEMPLATE),
    }
    assert manifest["pages"] == [
        {
            "pageId": "P-01",
            "pageRole": "research_method",
            "surfaceTemplateId": "r08-research-method-v1",
        }
    ]
    assert manifest["styles"]["body"] == {
        "font": "Noto Serif CJK KR",
        "point": 9.3,
        "ooxmlHalfPoints": 19,
        "effectiveOoxmlPoint": 9.5,
        "lineHeight": 1.52,
        "lineDxa": 365,
        "alignment": "justified",
        "characterSpacingPt": -0.2,
        "characterSpacingTwips": -4,
    }
    assert manifest["tables"] == [
        {
            "tableId": "TBL-01",
            "pageId": "P-01",
            "widthDxa": 8400,
            "columnWidthsDxa": [2400, 6000],
            "native": True,
        }
    ]
    assert manifest["figures"] == []
    assert manifest["artifacts"]["docx"]["sha256"] == _sha256(result.docx)
    assert manifest["inputs"]["pagePlanSha256"] == _canonical_sha(
        request.page_plan.model_dump(by_alias=True)
    )
    profile_sha = _canonical_sha(request.surface_profile.model_dump(by_alias=True))
    assert manifest["profile"] == {
        "profileId": "synthetic-korean-public-research-v1",
        "status": "locked",
        "sha256": profile_sha,
    }
    assert manifest["inputs"]["surfaceProfileSha256"] == profile_sha


def test_rejects_template_hash_drift_before_writing_outputs(tmp_path: Path) -> None:
    request = sample_request(tmp_path)
    request.template.sha256 = "0" * 64

    try:
        build_document(request)
    except ValueError as error:
        assert "template SHA-256" in str(error)
    else:
        raise AssertionError("template hash drift must block the build")

    assert not Path(request.output.docx_path).exists()
    assert not Path(request.output.manifest_path).exists()


def test_build_embeds_only_hash_bound_figure_on_its_planned_page(tmp_path: Path) -> None:
    # A deterministic 1x1 transparent PNG; the builder applies the locked Word width.
    figure = tmp_path / "figure.png"
    figure.write_bytes(
        b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8A"
            "AQUBAScY42YAAAAASUVORK5CYII="
        )
    )
    payload = sample_request(tmp_path).model_dump(by_alias=True)
    payload["figureManifest"]["figures"] = [
        {
            "figureId": "FIG-01",
            "pageId": "P-01",
            "path": str(figure),
            "sha256": _sha256(figure),
            "format": "png",
            "caption": "그림 1. 연구 수행 구조",
            "evidenceIds": ["EV-01"],
            "widthDxa": 3600,
        }
    ]
    payload["contentBlocks"][0]["figureIds"] = ["FIG-01"]

    result = build_document(BuildRequest.model_validate(payload))
    document_xml = _xml(result.docx, "word/document.xml")
    manifest = json.loads(result.manifest.read_text(encoding="utf-8"))

    assert "<w:drawing>" in document_xml
    assert 'wp:extent cx="2286000"' in document_xml
    assert manifest["figures"] == [
        {
            "caption": "그림 1. 연구 수행 구조",
            "embedded": True,
            "evidenceIds": ["EV-01"],
            "figureId": "FIG-01",
            "format": "png",
            "pageId": "P-01",
            "path": str(figure.resolve()),
            "sha256": _sha256(figure),
        }
    ]


def test_build_request_rejects_unknown_schema_version(tmp_path: Path) -> None:
    payload = sample_request(tmp_path).model_dump(by_alias=True)
    payload["schemaVersion"] = "2.0.0"

    with pytest.raises(ValidationError):
        BuildRequest.model_validate(payload)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda payload: payload["evidenceLedger"]["claims"][0].update(
                evidenceIds=["EV-UNKNOWN"]
            ),
            "claim evidenceIds must exist",
        ),
        (
            lambda payload: payload["evidenceLedger"]["bindings"][0].update(
                targetPageRole="wrong_role"
            ),
            "page role must match",
        ),
        (
            lambda payload: payload["evidenceLedger"]["claims"][0].update(
                evidenceIds=[]
            ),
            "links must be reciprocal",
        ),
    ],
)
def test_rejects_broken_evidence_page_cross_references(
    tmp_path: Path,
    mutate: object,
    message: str,
) -> None:
    payload = sample_request(tmp_path).model_dump(by_alias=True)
    mutate(payload)

    with pytest.raises(ValidationError, match=message):
        BuildRequest.model_validate(payload)


def test_rejects_figure_evidence_bound_to_another_page(tmp_path: Path) -> None:
    payload = sample_request(tmp_path).model_dump(by_alias=True)
    second_page = {
        **payload["pagePlan"]["pages"][0],
        "pageId": "P-02",
        "requirementId": "REQ-02",
        "pageRole": "expected_effect",
    }
    payload["pagePlan"]["pages"].append(second_page)
    payload["contentBlocks"].append(
        {
            **payload["contentBlocks"][0],
            "pageId": "P-02",
            "paragraphs": [],
            "tables": [],
            "figureIds": ["FIG-01"],
        }
    )
    payload["figureManifest"]["figures"] = [
        {
            "figureId": "FIG-01",
            "pageId": "P-02",
            "path": str(tmp_path / "not-read-during-validation.png"),
            "sha256": "b" * 64,
            "format": "png",
            "caption": "그림 1. 기대효과",
            "evidenceIds": ["EV-01"],
            "widthDxa": 3600,
        }
    ]

    with pytest.raises(ValidationError, match="figure evidenceIds must target"):
        BuildRequest.model_validate(payload)
