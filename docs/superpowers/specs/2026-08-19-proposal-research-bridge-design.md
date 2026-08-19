# Proposal Research Bridge 설계

- 작성일: 2026-08-19
- 상위 설계: [Public Proposal vNext](./2026-08-19-public-proposal-vnext-design.md)
- 소유 경계: Public Proposal은 요청, LongTable은 연구 실행, KPP는 검증과 receipt

## 1. 목표

한 번의 사용자 요청으로 기관 공식자료 우선 검색, 원자료 확보, 데이터 정규화, 지표 조작화, 근거 결합과 Figure 명세까지 수행한다. 한 번은 단일 검색 호출이 아니라 사용자 개입 없이 수행되는 bounded internal loop를 뜻한다.

## 2. 공유 계약 패키지

`@longtable/proposal-research-contracts`는 다음 strict schema와 hash canonicalization을 제공한다.

```text
ProposalResearchRequestV1
EvidenceDataBundleV1
SourceRecordV1
NormalizedDatasetV1
TransformationLineageV1
ClaimCandidateV1
SemanticFigureSpecV1
ResearchGapV1
```

패키지는 네트워크, 파일 다운로드, KPP 상태와 renderer를 포함하지 않는다.

## 3. Research Request

필수 필드는 다음과 같다.

```ts
interface ProposalResearchRequestV1 {
  schemaVersion: "proposal-research-request/v1";
  requestId: string;
  projectId: string;
  proposalClass: "academic_research" | "research_service" | "policy_research" | "general_procurement";
  requirementIds: string[];
  institution: {
    canonicalName: string;
    aliases: string[];
    identifiers: Record<string, string>;
  };
  questions: ResearchQuestion[];
  requiredData: RequiredDataField[];
  sourcePriority: SourceClass[];
  targetArtifacts: Array<"claim" | "table" | "figure" | "method">;
  budgets: { fullPass: 1; deltaPasses: 2 };
  privacyClass: "PUBLIC" | "PROJECT_CONFIDENTIAL";
}
```

각 `RequiredDataField`는 field ID, 정의, 기간, 단위, grain, 필수 여부, 허용 source class와 target claim/Figure를 선언한다.

## 4. Source 우선순위

`public-proposal` profile은 다음 순서로 검색한다.

1. 사용자 제공 RFP·첨부·기관자료
2. 발주기관·대상기관 공식 홈페이지와 원문 첨부
3. ALIO 공식 공시·API·다운로드
4. data.go.kr와 KOSIS 공식 API·파일데이터
5. 중앙부처·공공기관 정책·통계·연구보고서
6. LongTable scholarly full-text route
7. 일반 웹은 공식 원문 발견용

일반 웹, 검색 snippet과 abstract만으로 기관 사실을 verified로 만들 수 없다.

## 5. beta connector 범위

필수 입력 형식은 HWP/HWPX, PDF, DOCX, XLS/XLSX/CSV, JSON/XML과 HTML이다.

beta connector는 다음을 구현한다.

- local file ingest와 hash manifest
- official HTML link/attachment discovery
- ALIO entity resolution과 공시 수집
- data.go.kr/KOSIS connector interface와 고정 fixture
- 기존 LongTable scholarly evidence route

API key는 환경 또는 승인 connector가 관리한다. 키 값은 setup state, request, bundle과 receipt에 기록하지 않는다.

## 6. 데이터 처리

pipeline은 다음 순서를 고정한다.

```text
discover
-> acquire raw bytes
-> classify source and rights
-> parse
-> resolve institution/entity
-> normalize time, unit, code and grain
-> detect missing, duplicate and conflicts
-> derive approved metrics
-> produce claim candidates and figure specs
-> validate lineage
```

자동 허용 변환은 형식 정리, 합계, 평균, 명시적 분모의 비율, 증감률, 공식 분류에 따른 집계다. 비교기관 선정, 기간 구간화, 복수 source 결합과 해석 초안은 reviewer 승인이 필요하다. 성숙도 점수, 임의 가중 종합지수, 인과관계, 미래 예측, 목표수치와 기관 우열은 인간 승인 없이는 확정할 수 없다.

## 7. Bundle

bundle은 다음 구조를 가진다.

```text
research-bundle/
  bundle.json
  source-manifest.jsonl
  raw/
  normalized/
  transformations/
  claims/
  figures/
  gaps/
  handoff.json
```

`bundle.json`은 모든 file path와 SHA-256, 생성 도구와 contract version을 기록한다. `TransformationLineageV1`는 raw locator, normalization steps, derived formula, output cell/row, claim IDs와 figure IDs를 연결한다.

## 8. 완료와 delta 검색

완료는 source count가 아니라 request coverage로 판정한다.

- 필수 data field가 공식값 또는 공식 확인 불가 상태를 가짐
- 핵심 claim마다 직접 official source가 연결됨
- 단위, 연도, entity와 grain이 정규화됨
- 충돌이 해결되거나 명시적으로 열려 있음
- target table/Figure를 실제 데이터로 생성 가능함
- 필수 scholarly/method slot이 닫힘

최초 full pass 뒤 부족 field만 최대 두 번 delta 검색한다. 동일 gap이 두 번 해결되지 않으면 Researcher Checkpoint를 만든다. 일반 웹 추정값으로 필수 field를 채우지 않는다.

## 9. LongTable 내부 역할

LongTable `public-proposal` profile은 다음 내부 역할을 route한다.

- Institutional Source Scout
- Entity Resolver
- Data Extractor
- Data Quality Auditor
- Indicator Operationalizer
- Evidence Synthesizer
- Figure Specification Agent
- Interpretation Critic

역할은 사용자 스킬로 설치하지 않는다. 실행 결과는 하나의 accountable LongTable synthesis와 bundle로 정규화한다.

## 10. KPP import

KPP는 bundle schema, project identity, contract version, 실제 file hash, open critical gaps와 research checkpoint를 검증한다. content approval receipt는 사용된 bundle hash와 transfer decisions를 입력으로 포함한다.

원자료 또는 transformation이 바뀌면 연결된 claim, Figure와 content section만 invalidated 상태가 된다.

## 11. 오류 코드

```text
PP_RESEARCH_REQUEST_INVALID
PP_INSTITUTION_IDENTITY_AMBIGUOUS
PP_OFFICIAL_SOURCE_UNAVAILABLE
PP_DATA_GRAIN_MISMATCH
PP_DATA_UNIT_MISMATCH
PP_DATA_CONFLICT_OPEN
PP_TRANSFORMATION_UNTRACEABLE
PP_REQUIRED_DATA_GAP
PP_RESEARCH_BUNDLE_INVALID
PP_RESEARCH_DELTA_EXHAUSTED
```

## 12. 검증

- local fixture와 ALIO fixture에서 동일 normalized output hash
- 다른 기관 동명이인 매칭 차단
- 연도·단위·grain 불일치 차단
- raw field에서 Figure data point까지 lineage 100%
- delta 검색은 missing field만 요청
- key와 restricted proof가 bundle에 없음을 검사
- academic profile은 scholarly handoff 없이 approval-ready가 되지 않음
- general procurement는 academic slot이 없으면 LongTable을 호출하지 않음
