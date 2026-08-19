# Public Proposal 설치·이전·효과성 검증 설계

- 작성일: 2026-08-19
- 상위 설계: [Public Proposal vNext](./2026-08-19-public-proposal-vnext-design.md)

## 1. 설치 결과

사용자 명령은 하나를 유지한다.

```bash
npx @longtable/public-proposal setup --provider codex
```

설치 결과는 독립 plugin registration 두 개다.

```text
public-proposal@public-proposal
longtable@longtable
```

Public Proposal에는 사용자 스킬 하나만 설치한다. LongTable에는 `LongTable`과 `LongTable Research` 두 사용자 스킬만 설치한다. Public Proposal이 LongTable role skills를 자신의 `skills/`에 복사하지 않는다.

## 2. NPM 관계

`@longtable`은 발행 scope다. 제품 권한은 패키지 dependency가 아니라 contract로 구분한다.

```text
@longtable/public-proposal       meta-installer and router assets
@longtable/kpp-cli               proposal state and release authority
@longtable/cli                   research runtime authority
@longtable/proposal-research-contracts shared pure schemas
```

release manifest는 exact dependency version만 허용한다. `latest`, caret와 tilde dependency를 사용하지 않는다.

## 3. ownership

setup은 기존 LongTable registration과 source path를 검사한다.

- compatible external installation: 재사용, `externally_owned`
- absent: 별도 LongTable plugin 설치, `installer_owned`
- incompatible version: overwrite하지 않고 update preview
- same version/different hash: canonicality conflict

uninstall은 externally owned LongTable을 제거하지 않는다. installer-owned LongTable도 다른 registered consumer가 있으면 보존한다.

## 4. migration

update는 다음 순서를 트랜잭션으로 실행한다.

1. 기존 receipt, registration과 owned file hash snapshot
2. 새 LongTable plugin 별도 등록
3. LongTable doctor와 legacy project read 검사
4. Public Proposal single-skill plugin 설치
5. Research Bridge compatibility 검사
6. Public Proposal이 소유한 legacy role-skill 복사본만 제거
7. 새 receipt 원자적 기록
8. integrated doctor 성공 후 commit

실패 시 invocation에서 추가한 registration과 파일만 보상한다. `.longtable/`, 고객자료, KPP project state와 승인본은 삭제하지 않는다.

## 5. legacy invocation

legacy role skill 파일은 설치하지 않는다. 사용자가 과거 명칭을 텍스트로 입력하면 한 release cycle 동안 Public Proposal 또는 LongTable router가 deprecated route를 해석해 내부 lens로 전달하고 새 호출 표면을 안내한다.

기존 `.longtable` run은 `legacy_readable`이며 이동하거나 다시 쓰지 않는다. 새 bundle이 없으면 호환 가능한 ledger entry만 provisional로 import하고 부족 data는 delta request로 생성한다.

## 6. project adopt

`public-proposal adopt <project>`는 다음을 수행한다.

- RFP, source packet과 working master 후보 식별
- claim/evidence/Figure ledger import
- 기존 LongTable run 연결
- source 없는 content를 provisional로 분류
- Living Proposal Brief candidate와 decision diff 생성
- `UNMANAGED_DRAFT` 상태 생성

사용자 brief 승인과 대표 섹션 gate 없이 `CONTENT_APPROVED`로 전환하지 않는다.

## 7. doctor

통합 doctor는 독립 gate를 보고한다.

```text
publicProposalPlugin
longtablePlugin
kpp
researchBridge
contracts
worker
runtime
legacyConflicts
```

한 gate 실패를 전체 PASS로 요약하지 않는다. plugin 설치는 권한 확대를 의미하지 않는다.

## 8. benchmark

세 실제 RFP 유형을 사용한다.

- 기관 데이터 중심 연구용역: private KEITI packet
- 학술·정책 근거 중심 정책연구
- LongTable이 필요하지 않은 일반조달 또는 document restyle

비교군은 동일 input, model capability tier, 시간·token 상한을 사용한다.

```text
A current 0.1.3 workflow
B vNext router plus conditional LongTable
C B plus structured reviewer agents
```

먼저 problem, method, execution 대표 섹션을 비교하고 통과한 구성만 full document로 확장한다.

## 9. 평가

블라인드 인간평가는 Owner, Procurement와 Research/Editorial 세 관점을 분리한다. AI reviewer score는 인간평가와의 calibration에만 사용한다.

핵심 reader tasks는 문제·방법·근거·결정·실행을 이해하고 source를 찾으며 미확정 사항을 구분할 수 있는지다.

승격 기준은 다음과 같다.

- 인간평가 composite 10% 이상 개선
- evaluator usefulness, Korean naturalness, research/operations logic 중 5%p 이상 악화 없음
- unsupported institution claim 0
- wrong institution transfer 0
- mandatory claim official traceability 100%
- data Figure lineage 100%
- human revision time 감소
- total wall time 증가는 25% 이내
- LongTable 미필요 fixture의 research invocation 0

## 10. release

vNext는 `next` 또는 `beta` dist-tag로 먼저 배포한다. clean install, migration/rollback, three benchmark, external human review와 registry visibility를 통과한 뒤 `latest`로 승격한다.

release report는 `localArtifactVerified`, `registryAvailable`, `effectivenessValidated`와 `releaseReady`를 분리한다. 어느 하나도 다른 상태를 암시하지 않는다.

## 11. 검증

- clean temp HOME에 두 plugin registration과 정확한 user skill surface
- existing external LongTable 보존
- partial migration rollback과 retry idempotence
- legacy Public Proposal role skills 제거
- `.longtable`와 customer files의 no-write/no-delete guard
- adopt가 content approval을 자동 생성하지 않음
- full benchmark report와 raw evaluator score 보존
- beta가 effectiveness gate 전 `latest`로 publish되지 않음
