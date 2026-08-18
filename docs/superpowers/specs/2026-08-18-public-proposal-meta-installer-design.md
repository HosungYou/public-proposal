# Public Proposal 단일 설치 패키지 설계

- 작성일: 2026-08-18
- 저장소: `https://github.com/HosungYou/public-proposal`
- 사용자 진입점: `@longtable/public-proposal`
- Codex 플러그인 ID: `public-proposal`
- KPP 실행 정본: `@longtable/kpp-cli`
- 연구 거버넌스 정본: `@longtable/cli`
- 상태: 사용자 방향 승인 후 구현 전 설계

## 1. 결정

Public Proposal은 사용자가 한 번의 명시적 setup 명령으로 Codex 플러그인, 한국 공공제안서 규칙, KPP 실행기, LongTable 연구 계층과 DOCX Python worker를 설치하고 진단할 수 있는 meta-installer를 제공한다.

```bash
npx @longtable/public-proposal setup --provider codex
```

meta-installer는 KPP나 LongTable의 코드를 복제하여 새 정본을 만들지 않는다. 정확한 버전의 기존 정본 패키지를 조합하고, 설치 결과와 각 구성요소의 출처를 하나의 진단 결과로 보고한다.

## 2. 제품 경계

```text
@longtable/public-proposal
├── Public Proposal Codex plugin
│   ├── $public-proposal
│   └── korean-public-proposal rules, references, assets, and scripts
├── @longtable/kpp-cli                    KPP 상태와 release 정본
├── @longtable/cli                        LongTable 연구 정본
│   └── @longtable/scholar-research
└── managed KPP DOCX Python worker        문서 생성·OOXML 검사 정본
```

각 구성요소의 권위는 다음과 같이 고정한다.

| 구성요소 | 소유 권한 | 금지 사항 |
| --- | --- | --- |
| `$public-proposal` | 대화 맥락, 작업 라우팅, 구조화된 입력 준비 | KPP 상태·receipt 직접 변경 |
| `korean-public-proposal` | 발주처 우선 규칙, 한국 공공문서 문법, 표·도식·문체 기준 | 별도 release 판정 |
| `@longtable/kpp-cli` | 프로젝트 상태, receipt, build, audit, approval, release | 연구 결정을 임의 확정 |
| `@longtable/cli` | 연구질문·이론·방법·근거·인용 슬롯·연구자 checkpoint | DOCX·KPP receipt·release 변경 |
| Python worker | 결정론적 DOCX 생성과 OOXML 검사 | 제안서 사실·승인 상태 결정 |

KPP만 프로젝트 상태와 receipt를 쓴다. LongTable과 모든 리뷰 subagent는 읽기 전용 finding 또는 hash-bound handoff를 제출한다.

## 3. NPM 패키지 계약

새 공개 패키지 `@longtable/public-proposal`을 추가한다. 최초 릴리스 버전은 구현 시점의 전체 패키지 버전 정책에 맞추되, manifest에는 KPP와 LongTable의 정확한 버전을 사용한다. 범위 의존성이나 `latest`는 허용하지 않는다.

초기 설계 기준 버전은 다음과 같다.

```json
{
  "dependencies": {
    "@longtable/kpp-cli": "0.2.1",
    "@longtable/cli": "0.1.72"
  }
}
```

구현 전 더 최신 버전을 채택하려면 해당 버전의 clean install, doctor, KPP 통합 회귀검사를 같은 릴리스에서 다시 수행해야 한다. `@longtable/public-proposal` 버전 상승만으로 하위 정본 버전을 묵시적으로 변경하지 않는다.

## 4. 설치 명령과 부작용

### 4.1 setup

```bash
npx @longtable/public-proposal setup --provider codex
```

setup은 사용자가 명시적으로 호출하는 변경 명령이다. 다음 순서로 실행한다.

1. Node.js, npm, Codex CLI, Python, LibreOffice와 필수 글꼴을 사전 점검한다.
2. 배포 패키지에 포함된 `public-proposal` 플러그인과 repo marketplace entry를 검증한다.
3. Codex marketplace를 등록하고 `public-proposal` 플러그인을 설치한다.
4. 번들된 `korean-public-proposal` 규칙·references·assets·scripts가 플러그인 캐시에 존재하는지 검증한다.
5. 정확한 버전의 KPP CLI와 LongTable CLI를 설치한다.
6. LongTable Codex skills를 `compact` surface로 설치한다.
7. managed Python worker를 설치하고 protocol version을 확인한다.
8. 통합 doctor를 실행하고 설치 receipt를 기록한다.

setup은 성공하지 않은 단계를 성공처럼 보고하지 않는다. 기존 사용자 설정을 덮어써야 하는 경우 변경 전 경로와 충돌을 표시하고 중단한다. 자동으로 `--fix`, hook 설치 또는 MCP 설치를 활성화하지 않는다.

### 4.2 doctor

```bash
npx @longtable/public-proposal doctor --json
```

doctor는 읽기 전용이며 다음 독립 게이트를 보고한다.

- `plugin`: plugin manifest, marketplace, installed version, bundled skill files
- `kpp`: CLI version, supported Node, fonts, LibreOffice, worker protocol
- `longtable`: CLI version, Codex skill surface, provider adapter
- `scholarResearch`: source adapters and research-run readiness
- `authority`: exact version and SHA-256 lineage

통합 결과는 각 게이트 중 하나라도 실패하면 `ok: false`이다. 선택 기능의 미설정은 `warning`으로 분리하되, 학술·연구용역 모드의 LongTable 미설정은 blocker이다.

### 4.3 uninstall과 update

`uninstall`은 Public Proposal이 설치한 항목만 제거하고 기존 LongTable 프로젝트와 `.longtable/` 연구 상태는 삭제하지 않는다. `update`는 새 버전을 preview하고 사용자 확인 뒤 적용하며, KPP·LongTable·worker 버전 조합을 하나의 compatibility matrix로 검증한다.

## 5. Codex 플러그인 배포

저장소는 다음 구조를 가진 repo marketplace를 제공한다.

```text
.agents/plugins/marketplace.json
plugins/public-proposal/
├── .codex-plugin/plugin.json
├── skills/
│   ├── public-proposal/SKILL.md
│   └── korean-public-proposal/
│       ├── SKILL.md
│       ├── references/
│       ├── assets/
│       └── scripts/
└── scripts/
```

플러그인 설치는 스킬과 자원을 Codex에 제공하지만 shell, filesystem, network 또는 외부 서비스 권한을 확대하지 않는다. 실제 실행 권한은 Codex sandbox, approval policy와 workspace instruction을 그대로 따른다.

README에는 다음을 분리하여 표기한다.

- 한 줄 권장 설치
- 수동 plugin 설치
- 수동 KPP/LongTable 설치
- 통합 doctor
- 학술 모드 요구조건
- 업데이트·제거·복구

## 6. 제안서 유형과 LongTable 게이트

KPP 프로젝트 schema에 명시적 `proposalClass`를 추가한다.

```text
academic_research
research_service
policy_research
general_procurement
document_restyle
```

LongTable 요구조건은 다음과 같다.

| proposalClass | LongTable | 근거 |
| --- | --- | --- |
| `academic_research` | 필수 | 연구질문·이론·방법·인용 근거가 산출물의 핵심 |
| `research_service` | 필수 | 연구설계와 발주기관 적용 경계를 함께 잠가야 함 |
| `policy_research` | 필수 | 정책·법·기관 사실과 외부 연구의 전이 경계가 필요 |
| `general_procurement` | 조건부 | 학술 근거 슬롯이 생성된 경우에만 요구 |
| `document_restyle` | 불필요 | 승인된 기존 내용의 시각·서식 처리만 수행 |

프로젝트가 LongTable 필수 유형이면 KPP는 다음을 강제한다.

1. `plan` 결과에 research requirement와 required slots를 기록한다.
2. authoring export 전에 LongTable handoff를 가져오도록 요구한다.
3. `content-approve` 전에 `research-lock.json` receipt를 검증한다.
4. `approve`와 `release`에서 동일 research receipt와 source ledger hash를 재검증한다.

LongTable이 없더라도 source ingest와 requirement extraction은 허용한다. 연구 근거 없이 본문을 먼저 굳히지 않도록 authoring export 이후의 승인 경로를 차단한다.

## 7. Research lock 계약

LongTable은 KPP 상태를 직접 변경하지 않고 다음 handoff artifact를 출력한다.

```json
{
  "schemaVersion": "1.0.0",
  "longtableVersion": "0.1.72",
  "projectId": "example",
  "proposalClass": "research_service",
  "researchSpecificationSha256": "...",
  "citationSlotMatrixSha256": "...",
  "sourceLedgerSha256": "...",
  "claimTransferLedgerSha256": "...",
  "openRequiredCheckpoints": [],
  "createdAt": "ISO-8601"
}
```

KPP는 이 파일의 schema, 실제 파일 해시, project identity, LongTable version과 미해결 required checkpoint 수를 검증한 뒤 `research-lock.json`을 발급한다. 외부 연구 결과를 기관 성과·준비도·영향 주장으로 전이하는 항목은 명시적 transfer decision 없이는 차단한다.

## 8. 오류와 복구

설치 또는 연구 게이트 실패는 다음처럼 구분한다.

| 코드 | 의미 | 조치 |
| --- | --- | --- |
| `PP_PLUGIN_NOT_INSTALLED` | Codex plugin 부재 | marketplace와 plugin 설치 재검증 |
| `PP_KPP_VERSION_MISMATCH` | KPP 고정 버전 불일치 | compatibility matrix에 맞춰 재설치 |
| `PP_LONGTABLE_REQUIRED` | 필수 유형에서 LongTable 부재 | LongTable setup 수행 |
| `PP_LONGTABLE_VERSION_MISMATCH` | LongTable 고정 버전 불일치 | 승인된 버전으로 복구 |
| `PP_RESEARCH_LOCK_MISSING` | 연구 handoff/receipt 부재 | LongTable handoff 생성·KPP import |
| `PP_RESEARCH_CHECKPOINT_OPEN` | 필수 연구 결정 미해결 | 연구자가 checkpoint 결정 |
| `PP_WORKER_PROTOCOL_MISSING` | DOCX worker 미설치/불일치 | managed worker 재설치 |

어떤 자동 복구도 사용자 연구 결정을 대신하거나 `.longtable/` 상태를 삭제하지 않는다.

## 9. 보안과 데이터 경계

- npm과 plugin 패키지에는 고객 RFP, 인력, 실적, 가격, 미공개 연구자료를 포함하지 않는다.
- 설치자는 기존 Codex config, LongTable project state와 KPP project state를 삭제하지 않는다.
- hooks와 MCP는 별도 명시적 선택 없이는 설치하지 않는다.
- 설치 receipt에는 경로, 버전, package integrity와 manifest hash만 기록하고 비밀키를 기록하지 않는다.
- subagent는 proposal 파일과 receipt에 쓰지 못하며 구조화된 finding만 제출한다.

## 10. 검증 전략

### 10.1 meta-installer

- clean temp HOME에서 setup dry-run
- marketplace와 plugin entry validation
- exact dependency version assertion
- partial-install rollback
- repeat setup idempotence
- update preview and uninstall ownership

### 10.2 KPP–LongTable 통합

- 필수 유형에서 LongTable 부재 시 예상 blocker
- 일반 조달에서 LongTable 부재 허용
- valid handoff의 research receipt 발급
- open required checkpoint 차단
- project/version/hash mismatch 차단
- source ledger 변경 시 content approval·release 무효화

### 10.3 실제 환경

- fresh Codex session에서 두 bundled skills 발견
- `kpp doctor --json` worker protocol PASS
- `longtable doctor --json`과 `longtable scholar-research doctor --json` PASS
- 최소 학술 fixture가 research lock 이후 CONTENT_APPROVED까지 전이
- LongTable 없는 학술 fixture는 정확한 단계에서 BLOCKED

## 11. 완료 기준

다음 조건을 모두 충족해야 단일 설치 패키지가 준비된 것으로 본다.

1. `@longtable/public-proposal`이 npm에서 정확한 dependency와 package integrity를 제공한다.
2. 한 번의 setup으로 repo marketplace, plugin, KPP, LongTable skills와 worker가 설치된다.
3. 새 Codex 대화에서 `$public-proposal`과 bundled Korean authority가 사용 가능하다.
4. 통합 doctor의 모든 필수 게이트가 PASS이다.
5. 학술·연구용역 프로젝트가 valid research lock 없이는 승인·release되지 않는다.
6. 일반 조달과 재조판 작업은 불필요한 LongTable 상태를 만들지 않는다.
7. 설치·업데이트·제거가 기존 사용자 연구 상태와 고객 자료를 보존한다.

## 12. 명시적 비목표

- LongTable 코드를 KPP 저장소로 복제하거나 포크하지 않는다.
- 모든 제안서에 LongTable을 무조건 강제하지 않는다.
- 플러그인 설치로 Codex 권한을 확대하지 않는다.
- 연구자 checkpoint를 자동 승인하지 않는다.
- 기술 audit를 제출 승인으로 표현하지 않는다.
