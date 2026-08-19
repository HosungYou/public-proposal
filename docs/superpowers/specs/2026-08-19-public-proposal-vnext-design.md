# Public Proposal vNext 통합 제품 설계

- 작성일: 2026-08-19
- 상태: 사용자 방향 승인, 구현계획 전 서면 검토
- 저장소: `https://github.com/HosungYou/public-proposal`
- 연동 저장소: `https://github.com/HosungYou/LongTable`
- 현재 공개 기준선: `@longtable/public-proposal@0.1.3`, `@longtable/kpp-cli@0.2.1`, `@longtable/cli@0.1.72`

## 1. 목적

Public Proposal vNext는 기술적 무결성만 통과하는 문서가 아니라, 평가자와 실무자가 실제로 읽고 판단하고 실행할 수 있는 한국 공공제안서를 만든다.

제품의 1차 성공기준은 KPP 기술 PASS가 아니다. 동일 입력을 사용한 블라인드 비교에서 평가자 유용성, 한국어 자연스러움, 연구·운영 논리, 근거 추적성과 send-ready 판단이 현재 기준선보다 개선되고 인간 수정 부담이 줄어야 한다. 기술 PASS, 발주처 준수, 근거 안전성과 인간 승인은 타협할 수 없는 필요조건으로 유지한다.

## 2. 관찰된 실패와 원인

실제 KEITI 연구용역과 솔버톤 운영제안서 작업에서 다음 실패가 반복됐다.

- 페이지 수, 표·도식 수, 기하·폰트 같은 측정 가능한 대리 지표가 독자 유용성보다 우선됐다.
- 페이지마다 제목·부제·직접답변·근거 surface를 배치하는 문법이 연속 논증을 분절했다.
- 서로 비교할 수 없는 기관 수치가 의미 있는 분석처럼 도식화됐다.
- 한 프로젝트에서 사용자가 거부한 반복 박스, 내부 메타언어, 조어와 표 중심 구성이 다른 프로젝트에서 다시 나타났다.
- 승인된 문서를 다음 프로젝트의 기계적 profile로 승격하지 않아 참고 양식이 표면적 스타일로만 전이됐다.
- 실제 프로젝트 빌더가 KPP 상태와 receipt를 우회해 제품의 정책과 회귀검사가 산출물에 적용되지 않았다.
- LongTable은 학술 근거 복구에는 유용했지만 기관 공식자료, 표형 데이터, 조작화와 Figure 명세를 하나의 연구 계약으로 반환하지 못했다.

원인은 금지 프롬프트가 부족해서가 아니다. 작성 목표, 연구 계약, 인간 편집 게이트, 결정 지속성, 데이터-to-Figure 계약과 실행 권한이 분리되지 않은 것이 원인이다.

## 3. Positive Proposal Design Doctrine

생성 에이전트에는 긴 금지목록 대신 다음 여섯 원칙을 전달한다.

1. 독자의 질문에 답하되 문서는 하나의 자연스러운 논증으로 이어지게 한다.
2. 확인된 사실에서 해석을 도출하고 그 해석이 다음 결정이나 행동으로 이어지게 한다.
3. 추상적인 체계보다 누가 무엇을 어떻게 수행하는지를 구체적으로 쓴다.
4. 표와 도식은 비교·이해·판단을 실제로 더 쉽게 만들 때만 사용한다.
5. 미확정 사항은 감추거나 채우지 않고 결정 주체와 다음 행동을 명확히 한다.
6. 형식은 내용과 독자의 읽기 흐름을 돕도록 선택하며 모든 페이지를 같은 틀에 맞추지 않는다.

작성 packet은 이 doctrine, 대상 독자, 과업, 근거 경계와 승인 reference만 포함한다. 과거 실패와 anti-pattern은 reviewer packet과 회귀 fixture에만 제공한다.

절대 blocker는 다음 다섯 종류로 제한한다.

- 발주처 공식 요구 위반
- 출처 없는 기관·인력·실적·수치 주장
- 개인정보·보안 위반
- 인간이 승인하지 않은 확정·제출 상태
- 손상되거나 재현할 수 없는 산출물

문체, 색상, 박스, 표와 도식은 목적 기반 평가와 인간 판단을 허용한다.

## 4. 제품 표면과 권한

사용자에게 보이는 Public Proposal 스킬은 하나다.

```text
Public Proposal
```

LongTable은 별도 플러그인과 NPM 정본으로 유지하며 사용자 표면은 다음 두 개로 제한한다.

```text
LongTable
LongTable Research
```

기존 `longtable-theory`, `longtable-methods`, `longtable-measure`, `longtable-panel`, `longtable-voice`, `longtable-reviewer`, `longtable-start`, `longtable-interview`와 `scholar-research`는 Public Proposal 플러그인의 최상위 스킬로 설치하지 않는다. 역할은 LongTable 내부 lens 또는 Public Proposal의 자동 subagent profile로 사용한다.

권한은 다음처럼 고정한다.

| 구성요소 | 소유 권한 | 금지 사항 |
| --- | --- | --- |
| Public Proposal router | 사용자 맥락, workflow 선택, agent routing, 구조화된 입력 준비 | KPP receipt와 release 직접 변경 |
| KPP | 프로젝트 상태, 계약 검증, receipt, build, audit, approval, release | 연구 checkpoint 임의 확정 |
| LongTable | 연구 계약 실행, 기관·정책·학술 근거, 데이터 bundle, 연구자 checkpoint | 제안서 정본, DOCX, KPP 상태 변경 |
| Proposal Editor | 승인된 patch를 proposal source에 적용 | receipt·release 상태 직접 변경 |
| Reviewer agents | hash-bound finding과 patch proposal | proposal source와 receipt 쓰기 |
| DOCX worker/renderers | 결정론적 문서·Figure 렌더링 | 사실·근거·승인 결정 |

## 5. 통합 구조

```text
사용자 요청
  -> Public Proposal router
     -> Living Proposal Brief와 KPP 상태 로드
     -> proposal class, stage, risk 판정
     -> Proposal Research Contract 생성
        -> LongTable public-proposal profile
           -> Evidence and Data Bundle
        -> KPP research/data lock
     -> Section-centered authoring
     -> 대표 섹션 3종 editorial review
     -> 사용자 승인
     -> 전체 문서 authoring
     -> Visual Evidence Compiler
     -> independent reviewer findings
     -> Proposal Editor adjudication
     -> KPP build/render/audit
     -> named human approval
     -> release
```

Public Proposal과 LongTable은 스킬 파일 복사가 아니라 다음 versioned protocol로 연결한다.

```text
proposal-research-request/v1
proposal-evidence-bundle/v1
transformation-lineage/v1
semantic-figure-spec/v1
reviewer-finding/v1
```

공유 계약은 실행 코드를 포함하지 않는 순수 schema package `@longtable/proposal-research-contracts`로 배포한다.

## 6. 하위 설계

이 umbrella 설계는 다음 독립 설계로 구현을 분리한다.

1. [Proposal Research Bridge](./2026-08-19-proposal-research-bridge-design.md)
2. [Living Brief와 Positive Policy](./2026-08-19-proposal-living-brief-policy-design.md)
3. [Section Authoring과 Agent Review](./2026-08-19-proposal-section-agent-workflow-design.md)
4. [Visual Evidence Compiler](./2026-08-19-visual-evidence-compiler-design.md)
5. [설치·이전·효과성 검증](./2026-08-19-public-proposal-install-migration-eval-design.md)

각 하위 설계는 자체 테스트와 review gate를 가진다. 어느 한 하위 기능의 실패를 다른 기능의 통합 PASS로 숨기지 않는다.

## 7. 프로젝트 상태

기존 KPP 상태는 유지하되 editorial 상태와 외부 계약을 명시한다.

```text
INIT
-> SOURCE_LOCKED
-> REQUIREMENTS_LOCKED
-> BRIEF_LOCKED
-> RESEARCH_LOCKED
-> DESIGN_LOCKED
-> REPRESENTATIVE_REVIEW_REQUIRED
-> REPRESENTATIVE_APPROVED
-> CONTENT_APPROVED
-> BUILT
-> RENDERED
-> AUDITED
-> HUMAN_APPROVED
-> RELEASED
```

`RESEARCH_LOCKED`는 proposal class에 따라 optional일 수 있다. `document_restyle`은 필요하지 않고, `general_procurement`은 academic evidence slot이 있을 때만 필요하다.

KPP 상태가 없는 기존 작업은 `UNMANAGED_DRAFT`로 import한다. `adopt`는 원자료, 현재 working master, claim/evidence/figure ledger와 기존 LongTable run을 연결하지만 콘텐츠 승인이나 제출 상태를 자동 부여하지 않는다.

## 8. 대표 섹션과 인간 편집 게이트

전체 문서 작성 전에 다음 성격의 대표 섹션 세 개를 완성한다.

- 문제정의·필요성
- 연구방법 또는 실제 수행방법
- 실행·성과와 의미 있는 데이터 도식

공고가 세 유형 중 하나를 요구하지 않으면 해당 제안서의 핵심 독자 과업을 대표하는 동등한 섹션으로 교체한다. 독립 agent review 이후 사용자가 문체, 논증, 시각적 의미성과 실제 활용 가능성을 승인해야 `REPRESENTATIVE_APPROVED`로 전환한다.

자동 QA와 agent 패널은 이 인간 편집 게이트를 대신하지 않는다.

## 9. 자동 agent 원칙

Public Proposal router는 stage와 risk에 따라 필요한 역할만 자동 호출한다.

- Proposal Architect
- RFP/Compliance Reviewer
- Institutional Evidence and Data Reviewer
- Methods/Evidence Reviewer
- Korean Prose Reviewer
- Visual/Render Reviewer
- Evaluator Red Team
- Proof/Privacy Reviewer

모든 역할을 항상 호출하지 않는다. 일반 조달·재조판은 `quick`, 연구용역은 `standard`, 고위험 대형 제안서와 최종 benchmark는 `deep` profile을 사용한다.

1차 검토는 독립적으로 수행하고, 관련 finding만 한 차례 directed cross-review한다. agent 간 자유 대화와 공유 proposal 파일 쓰기는 허용하지 않는다. Proposal Editor만 승인된 patch를 적용한다.

## 10. 보안과 격리

데이터 등급은 `PUBLIC`, `PROJECT_CONFIDENTIAL`, `RESTRICTED_PROOF`, `SECRET`이다. `SECRET`은 agent prompt, bundle, ledger와 receipt에 포함하지 않는다.

agent는 role-specific read-only packet만 받는다. packet은 input hash, 허용 목적, redacted context와 output directory를 가진다. proof·privacy 작업은 외부 네트워크를 사용하지 않는다. LongTable은 공개·합법적 근거를 다루고 restricted proof를 연구 ledger에 복제하지 않는다.

## 11. 복구와 재개

연구와 agent 실행은 immutable run으로 관리한다. 완료 artifact는 schema, input hash와 output hash가 모두 검증된 후 원자적으로 `SUCCEEDED`가 된다. 불완전 결과는 `QUARANTINED`이며 downstream 입력이 될 수 없다.

재개 시 동일 input hash와 동일 contract/tool version의 성공 결과만 재사용한다. 원자료 변경은 연결된 normalized data, derived metric, Figure와 본문 해석만 무효화한다. 동일 실패가 두 번 반복되면 자동 재시도를 중단하고 사용자 checkpoint로 전환한다.

## 12. 품질과 효과성

품질의 중심지표는 다음 두 개다.

- `send-ready rate`: 인간이 실제 발송 가능한 수준이라고 판단한 비율
- `human revision burden`: 승인까지 사람이 다시 작성한 문장·도식·소요시간

보조지표는 requirement direct-answer coverage, supported-claim precision, unsupported institution claim, source-to-Figure traceability, evaluator usefulness, Korean naturalness, tool calls, wall time과 unused research rate다.

동일 입력을 사용하는 블라인드 benchmark에서 vNext는 현재 기준선보다 인간평가 종합점수가 10% 이상 개선돼야 한다. 핵심 차원은 5%p 이상 악화되면 안 되고 전체 작업시간 증가는 25% 이내여야 한다. unsupported institution claim과 잘못된 기관 사실 전이는 0건이어야 한다.

KEITI 자료는 private benchmark로 사용한다. 공개 NPM과 GitHub에는 synthetic fixture와 독립적으로 재구축한 visual regression asset만 포함한다.

## 13. 최초 beta 범위

첫 beta는 다음 vertical slice를 완성한다.

- Public Proposal 단일 사용자 스킬
- Public Proposal과 LongTable의 독립 plugin registration
- Research Contract와 Evidence/Data Bundle v1
- 로컬 문서, 기관 공식 페이지·첨부파일, ALIO와 기존 학술검색
- section-centered authoring과 `adopt`
- 대표 섹션 인간 승인
- 최소 6개 내부 agent 역할
- 6개 Visual Evidence Compiler family
- Living Proposal Brief와 decision diff
- KEITI, 정책연구, 일반조달의 세 benchmark 유형

`data.go.kr`과 KOSIS는 connector interface와 안정적인 fixture를 beta에 포함하고 전체 source coverage는 후속 릴리스에서 확장한다.

## 14. 명시적 비목표

- 모든 사용자 결정을 global rule로 자동 승격하지 않는다.
- 긴 금지목록을 생성 프롬프트에 반복 주입하지 않는다.
- 모든 제안서에 LongTable, 모든 agent 또는 deep profile을 강제하지 않는다.
- 실제 기관 reference 페이지와 고객자료를 공개 패키지에 포함하지 않는다.
- 생성형 이미지 결과를 증거·수치·한국어 텍스트가 포함된 최종 Figure로 사용하지 않는다.
- 기술 audit를 인간 승인이나 submission readiness로 표현하지 않는다.
- vNext beta 효과가 입증되기 전에 `latest`로 승격하지 않는다.

## 15. 완료 조건

1. 새 Codex 대화에서 Public Proposal 하나만 사용자 제안서 진입점으로 보인다.
2. LongTable은 별도 plugin과 두 사용자 스킬로 보이며 기존 project state를 보존한다.
3. 동일 사용자 요청이 기관 우선 검색부터 data-to-Figure bundle까지 한 workflow로 완료된다.
4. 대표 섹션 승인 전 전체 문서 확장이 차단된다.
5. subagent는 정본과 receipt를 수정할 수 없다.
6. vNext가 세 benchmark 유형의 객관·인간평가 gate를 통과한다.
7. 설치, update와 uninstall이 외부 소유 LongTable과 고객자료를 보존한다.
