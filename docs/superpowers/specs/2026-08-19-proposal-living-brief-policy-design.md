# Living Proposal Brief와 Positive Policy 설계

- 작성일: 2026-08-19
- 상위 설계: [Public Proposal vNext](./2026-08-19-public-proposal-vnext-design.md)

## 1. 목표

대화 전체를 규칙으로 저장하지 않으면서 중요한 사용자 결정을 다음 작업과 agent run에 안정적으로 전달한다. 생성에는 짧은 긍정 doctrine을 사용하고 과거 실패는 review layer에만 제공한다.

## 2. Living Proposal Brief

brief는 다음 필드만 가진다.

```ts
interface LivingProposalBriefV1 {
  schemaVersion: "living-proposal-brief/v1";
  projectId: string;
  proposalClass: string;
  problem: string;
  primaryReaders: ReaderTask[];
  doctrineVersion: string;
  evidenceBoundary: string[];
  activeDecisions: DecisionRecordV1[];
  openDecisions: OpenDecisionV1[];
  approvedReferences: ReferenceBindingV1[];
  nextHumanGate: string;
}
```

brief에는 raw conversation, hidden reasoning, secret, 전체 고객문서와 agent transcript를 저장하지 않는다.

## 3. Decision Record

중요 결정만 기록한다.

```ts
interface DecisionRecordV1 {
  decisionId: string;
  scope: "global" | "proposal_family" | "project" | "document" | "temporary";
  statement: string;
  rationale: string;
  source: { threadId?: string; turnId?: string; artifactHash?: string };
  status: "active" | "superseded" | "expired";
  supersedes: string[];
  affects: string[];
  approvedBy: string;
  approvedAt: string;
}
```

다음 경우만 기록한다.

- 범위·책임·독자 확정
- 중요 방법·문체·시각 방향 승인
- 기존 결정 변경
- 미확정 값을 확정
- 대표 섹션·Figure 승인
- 제출 상태 변경

짧은 `응`, `수용`, `제안대로`는 직전에 제시된 단일 `decisionId`에만 연결한다. 한 응답으로 여러 질문을 암묵 승인하지 않는다.

## 4. 결정 우선순위와 충돌

```text
issuer rule
-> explicit current project decision
-> approved proposal-family profile
-> approved reference pattern
-> plugin default
```

새 결정이 active 결정과 충돌하면 기존 결정을 자동 삭제하지 않는다. old/new statement, 영향을 받는 sections/figures/budget와 재승인 범위를 보여준 뒤 새 결정이 승인되면 기존 record를 `superseded`로 변경한다.

## 5. scope 승격

결정은 기본적으로 project scope다.

- 같은 장르에서 반복 승인되면 proposal-family 후보
- 둘 이상의 장르에서 반복 승인되면 global 후보
- 사용자가 모든 제안서 적용을 명시하면 global 후보
- 승격은 프로젝트 완료 후 별도 인간 승인 필요
- issuer와 충돌하면 해당 프로젝트 exception

자동 승격은 허용하지 않는다.

## 6. Positive authoring packet

작성 에이전트가 받는 packet은 다음으로 제한한다.

- doctrine 여섯 문장
- 대상 독자와 reader tasks
- 현재 section의 목적
- 허용 claim/evidence IDs
- open decisions
- 승인 reference 2~3개
- 해당 장르의 긍정 profile

긴 금지목록과 rejected artifact는 작성 packet에 넣지 않는다.

## 7. Review packet

reviewer는 다음을 추가로 받는다.

- active project decisions
- relevant anti-pattern IDs
- 이전 incident의 최소 재현 fixture
- expected reader tasks
- current artifact hash

reviewer finding은 위반 규칙을 나열하는 것이 아니라 독자 과업과 실제 영향으로 설명한다.

## 8. proposal-family profile

`research_service` profile은 연속 연구 논증, 기관자료의 예비분석 경계, 방법론의 대상·자료·분석·검증과 대표 연구 섹션을 강조한다.

`operations_proposal` profile은 목적, 사전조건, 담당자, 실제 행동, 예외처리, 기록과 완료기준을 강조한다. 일정·책임·조회에는 표를, 실제 처리 흐름에는 스윔레인을 허용한다.

두 profile 모두 global denylist를 상속하지 않는다. Positive Doctrine과 hard blocker만 공유한다.

## 9. decision diff

각 주요 단계 종료 시 다음만 사용자에게 보여준다.

```text
confirmed
changed
still open
invalidated downstream
next human gate
```

검색·lint·agent activity 자체는 decision diff가 아니다.

## 10. KPP integration

`BRIEF_LOCKED` receipt는 brief hash, doctrine version, active decision IDs와 open critical decision IDs를 기록한다. brief가 바뀌면 affected receipt만 무효화한다.

KPP가 없는 기존 프로젝트는 thread/artifact에서 decision candidate를 추출할 수 있지만 사용자가 diff를 승인하기 전 active decision으로 import하지 않는다.

## 11. 검증

- `응`이 두 개 이상의 decision을 승인하지 못함
- superseded 결정이 authoring packet에 나타나지 않음
- global 승격은 explicit human approval 없이는 실패
- issuer conflict가 project exception 없이 lock되지 않음
- rejected anti-pattern이 authoring packet에 포함되지 않음
- decision 변경 시 영향받는 section/Figure만 invalidated
- raw conversation과 secret가 brief receipt에 포함되지 않음
