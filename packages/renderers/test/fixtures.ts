import { R08_TOKEN_PROFILE_SHA256, type GanttFigureSpec } from "../src/index.js";

export const ganttFixture: GanttFigureSpec = {
  figureId: "FIG-GANTT-001",
  family: "gantt",
  title: "연구 수행 일정",
  caption: "그림 1. 연구 수행 일정과 검토 관문",
  evidenceIds: ["EV-SCHEDULE-001"],
  claimIds: ["CL-SCHEDULE-001"],
  inputKind: "semantic",
  tokenProfileHash: R08_TOKEN_PROFILE_SHA256,
  semanticValueIntent: "operational_control",
  decisionEffect: "과업의 담당자와 승인 관문을 확정한다.",
  nonDuplicateOf: ["BLK-SCHEDULE-NARRATIVE"],
  encodedVariables: ["owner", "timing", "acceptance"],
  data: {
    kind: "time_axis",
    periods: ["1개월", "2개월", "3개월", "4개월"],
    workPackages: [
      {
        id: "WP1",
        label: "현황 진단",
        owner: "연구책임자",
        start: 0,
        end: 1,
        evidenceIds: ["EV-WP1"],
      },
      {
        id: "WP2",
        label: "실행안 설계",
        owner: "분석팀",
        start: 1,
        end: 3,
        evidenceIds: ["EV-WP2"],
      },
    ],
    milestones: [
      {
        id: "MS1",
        label: "중간보고 승인",
        period: 2,
        owner: "발주기관",
        evidenceIds: ["EV-MS1"],
        acceptance: "수용",
      },
    ],
  },
};
