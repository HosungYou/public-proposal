# Visual Evidence Compiler 설계

- 작성일: 2026-08-19
- 상위 설계: [Public Proposal vNext](./2026-08-19-public-proposal-vnext-design.md)

## 1. 목표

도식을 장식이나 페이지 채움이 아니라 근거에서 판단으로 이어지는 시각적 논증으로 만든다. AI는 분석 목표와 후보 topology를 탐색하지만 최종 수치·한국어·관계는 structured spec에서 결정론적으로 렌더링한다.

## 2. 처리 흐름

```text
Evidence/Data Bundle
-> analytical question and reader task
-> Semantic Figure Spec
-> governed reference retrieval
-> 2~3 logically distinct candidate specs
-> constraint ranking
-> deterministic SVG/PNG render
-> independent visual QA
-> representative Figure human approval
-> KPP figure lock
```

후보는 색상 변형이 아니라 다른 독해 전략을 제시해야 한다. 예산 자료라면 추세, 구성 변화와 증감 기여처럼 분석 질문이 다른 후보를 만든다.

## 3. Semantic Figure Spec

필수 필드는 다음과 같다.

```ts
interface SemanticFigureSpecV1 {
  schemaVersion: "semantic-figure-spec/v1";
  figureId: string;
  requirementIds: string[];
  analyticalQuestion: string;
  readerTask: string;
  supportedTakeaway: string;
  dataIds: string[];
  relationship: "trend" | "comparison" | "composition" | "matrix" | "process" | "framework";
  minimumDataConditions: Record<string, number | boolean | string>;
  uncertainty: string[];
  sourceCaption: SourceCaptionV1;
  targetSurface: "A4_DOCX" | "A4_PDF";
  referenceFamily: string;
  rendererVersion: string;
  approvalStatus: "candidate" | "reviewed" | "human_approved";
}
```

`supportedTakeaway`는 데이터가 지지하는 범위를 넘어갈 수 없다. Figure는 연결된 section에서 호출되고 해석돼야 한다.

## 4. beta Figure family

- 시간 추세
- 항목·기관 비교
- 구성비 변화
- 지표·요구사항 matrix
- 연구·수행 절차
- 연구 분석 framework

각 family는 data sufficiency, honest scale, label/caption, grayscale, A4 footprint, fallback form과 anti-pattern을 가진다.

## 5. Reference Library

reference는 세 저장등급을 가진다.

### Private Source Reference

실제 기관 문서와 페이지는 project/private storage에 보관한다. source class, URL/path, 취득일, hash, page, rights와 transferable boundary를 기록한다. NPM과 public GitHub에 원문을 포함하지 않는다.

### Extracted Visual Pattern

기관 사실·문구·로고·고유색을 제거한 정보 위계, density, chart/diagram grammar와 reader task다. 인간 승인 후 personal library 또는 proposal-family candidate가 된다.

### Public Canonical Fixture

직접 제작한 synthetic data, schema, deterministic SVG, token과 good/bad regression fixture다. 제3자 페이지를 복제하지 않는다.

## 6. 생성과 renderer 경계

LLM과 image generation은 visual goal, candidate family와 topology 탐색에 사용할 수 있다. 최종 Figure의 한국어, 수치, scale, node/edge 관계, evidence ID, 로고, 공식 표와 score는 생성 이미지에서 가져오지 않는다.

차트는 declarative spec을 canonical intermediate representation으로 사용하고, 복합 diagram은 node/edge/group/layer schema를 사용한다. renderer는 동일 spec, data와 version에서 동일 output hash를 생성해야 한다.

## 7. QA 역할

- Data Integrity Auditor
- Visual Encoding Critic
- Public Document Art Director
- Figure Semantics Reviewer
- Evaluator Task Reviewer
- Render/Accessibility Auditor

생성 agent는 자신의 최종 Figure QA 승인자가 될 수 없다.

자동 QA는 source/data mismatch, unit, denominator, axis, sample sufficiency, label collision, clipping, contrast, grayscale, palette token, caption, section callout, repeated family와 lineage를 검사한다.

멀티모달 reviewer와 인간은 시각 위계, 인지부하, 의미 전달, 공공문서 적합성, 인접 본문과의 설득력을 판단한다.

## 8. promotion

pattern은 source/rights, 추출한 원칙, transfer boundary, 최소 두 프로젝트의 유용성 또는 explicit human approval, reader task, failure condition과 independent spec이 있을 때만 재사용 정본 후보가 된다.

빈도만으로 승격하지 않는다. 사용자 승인 reference는 personal layer에 먼저 저장하며 공개 canon 승격은 별도 승인이다.

## 9. 회귀

- 동일 spec/data/renderer의 byte-stable SVG
- raw source에서 모든 plotted point까지 lineage
- 8개 미만 temporal point에서 부정직한 line chart fallback
- 비교 불가능한 단위·grain 차단
- repeated surface geometry와 page-level clutter 탐지
- grayscale과 print-size legibility
- approved reference geometry drift
- rejected KEITI/솔버톤 pattern의 private anti-pattern regression

## 10. 인간 승인

대표 Figure는 최종 A4 page context에서 pairwise 비교한다. 사용자는 의미성, 신뢰성, 문서 적합성과 실제 발송 가능성을 승인한다. 자동 visual PASS만으로 `human_approved`가 될 수 없다.
