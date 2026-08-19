# Section Authoring과 Agent Review 설계

- 작성일: 2026-08-19
- 상위 설계: [Public Proposal vNext](./2026-08-19-public-proposal-vnext-design.md)

## 1. 목표

페이지별 template과 직접답변을 콘텐츠 모델에서 제거하고, 제안서 장르에 맞는 section과 논증 흐름을 먼저 작성한다. 자동 subagent는 독립적으로 검토하되 proposal 정본과 KPP receipt를 수정하지 않는다.

## 2. Section Plan

```ts
interface SectionPlanV1 {
  schemaVersion: "section-plan/v1";
  projectId: string;
  sections: SectionPlanItemV1[];
}

interface SectionPlanItemV1 {
  sectionId: string;
  parentSectionId: string | null;
  purpose: string;
  readerTasks: string[];
  requirementIds: string[];
  claimIds: string[];
  evidenceIds: string[];
  argumentMoves: Array<"problem" | "evidence" | "interpretation" | "method" | "limit" | "decision" | "action">;
  visualNeeds: VisualNeedV1[];
  openDecisionIds: string[];
  representativeRole: "problem" | "method" | "execution" | null;
}
```

page ID, page break, surface template와 필수 Figure는 section authoring input이 아니다. renderer가 승인 콘텐츠, issuer page limit와 실제 layout을 이용해 pagination한다.

요구사항 direct answer는 compliance matrix와 section metadata에 유지한다. 최종 본문에 `평가자 직접답변` 같은 메타문구를 자동 삽입하지 않는다.

## 3. authoring response

section response는 paragraphs, structured table/figure references, claim/evidence bindings와 unresolved decisions를 반환한다. 별도 `evaluatorAnswer` field를 필수로 요구하지 않는다.

문단은 가능한 경우 `claim/evidence -> interpretation/limit -> implication/action`의 연결을 포함하지만 모든 문단에 동일한 형식을 강제하지 않는다.

## 4. 대표 섹션 gate

router는 전체 authoring 전에 다음 대표 role을 선택한다.

- problem
- method
- execution

각 대표 섹션은 prose, 필요한 table/Figure, evidence binding과 rendered page context를 포함한다. Prose, Evaluator, Compliance, Evidence와 Visual reviewer가 독립 검토한 후 Proposal Editor가 patch를 병합한다. 사용자가 세 대표 role을 승인해야 전체 authoring이 가능하다.

## 5. 자동 agent matrix

| Trigger | Agent |
| --- | --- |
| 모든 proposal | Proposal Architect, Compliance Reviewer |
| research/policy/academic slot | Methods/Evidence Reviewer |
| institution fact/data | Institutional Evidence and Data Reviewer |
| representative gate | Korean Prose Reviewer, Evaluator Red Team |
| figure/table present | Visual/Render Reviewer |
| qualification/PII/blind copy | Proof/Privacy Reviewer |
| final release | fresh-context Submission Gate Reviewer |

`quick`은 최대 동시 3, `standard`는 6, `deep`은 10 thread를 허용한다. 동일 finding의 rebuttal은 한 번, 동일 section 자동 수정은 두 번, 한 stage의 agent 생성은 12개로 제한한다.

## 6. agent packet과 finding

모든 agent는 hash-bound read-only packet을 받는다.

```ts
interface ReviewerFindingV1 {
  findingId: string;
  artifactHash: string;
  target: { sectionId?: string; claimId?: string; figureId?: string };
  authorityClass: "issuer" | "evidence" | "method" | "editorial" | "visual" | "privacy" | "release";
  severity: "blocker" | "editorial_hold" | "warning";
  readerImpact: string;
  evidence: string[];
  proposedPatch: PatchProposalV1 | null;
  confidence: number;
  dependencies: string[];
}
```

patch proposal은 original excerpt/hash, replacement draft/spec, reason, evidence IDs, affected requirements와 risk를 포함한다. reviewer는 patch를 적용하지 않는다.

## 7. adjudication

1차 review는 서로의 finding을 보지 않는다. 이후 directed cross-review만 허용한다.

- Evidence -> Prose: claim 범위 확인
- Compliance -> Editor: issuer conflict
- Prose -> Evidence: 읽을 수 없는 근거 표현
- Visual -> Editor: layout feasibility
- Methods -> Evaluator: 연구설계와 평가 유용성

한 차례 rebuttal 후 Proposal Editor가 authority order와 reader impact로 판정한다. 채택, 수정채택, 기각과 이유를 adjudication receipt에 기록한다.

## 8. 차단 정책

issuer 위반, unsupported institution claim, required research checkpoint, privacy/blind violation과 document corruption은 hard blocker다.

문체, 논증과 시각적 의미성은 단일 agent가 차단하지 않는다. 관련 두 reviewer가 동일한 중대 결함을 독립 판정하면 `EDITORIAL_REVIEW_REQUIRED`가 된다. 사용자는 이유를 기록하고 override할 수 있으며 모든 override는 최종 승인 전에 다시 제시된다.

## 9. prose와 visual evaluation

prose lint는 금칙어 수보다 paragraph reasoning, 주체·행동 명료성, section continuity, 제목 반복, 명사 적층, sentence rhythm과 evaluator task를 평가한다.

자동 평가는 결함 탐지다. 최종 품질은 pairwise 인간평가와 send-ready 판단으로 확인한다.

## 10. 복구

agent run은 immutable하다. timeout과 partial output은 `QUARANTINED`이며 finding으로 채택하지 않는다. 동일 input/tool/profile의 성공 finding은 재사용한다. source, brief 또는 section hash 변경 시 관련 finding만 invalidated한다.

## 11. 검증

- page plan 없이 multi-page continuous section 작성
- evaluator answer metadata가 final prose에 노출되지 않음
- 대표 섹션 미승인 상태에서 full authoring 차단
- reviewer가 proposal source/receipt에 쓰지 못함
- two-reviewer editorial hold와 human override receipt
- source hash 변경 시 관련 section finding만 무효화
- quick general procurement에서 불필요한 LongTable/Methods agent 호출 0회
