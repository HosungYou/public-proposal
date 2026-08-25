import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const auditorPath = join(
  process.cwd(),
  "plugins",
  "public-proposal",
  "skills",
  "korean-public-proposal",
  "scripts",
  "audit_prose_contract.py",
);
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

test("public_bullet accepts restrained measured report prose", async () => {
  const report = await runAudit(
    "public_bullet",
    [
      "---",
      "작성: 2026. 8. 25. 내부검토",
      "---",
      "# 추진방향",
      "> 약국 현장과 지역 파트너를 연결하고, 단계별 실증을 통해 지속 가능한 운영 기반을 마련하고자 함.",
      "❍ (운영구조) 약사회·참여약국·수행기관의 역할과 승인 절차 명확화",
      "  - 참여약국 20개소를 대상으로 2026. 9. ~ 11. 단계별 실증 추진",
      "⇒ 약사 승인 중심의 현장 운영체계 구축 필요",
      "※ 근거: [EVIDENCE_01] 참여약국 수요조사",
      "> [도식 1] 약국 확인부터 공급 완료까지의 책임 이관",
      "## 근거",
      "- HWPX 생성 도구: jkf87/hwpx-skill commit 96a2633f23a08f707679d7e212ebdc59948260e6",
    ].join("\n"),
  );

  expect(report.status).toBe("PASS");
  expect(report.humanReviewRequired).toBe(true);
  expect(report.metrics.evidenceBearingUnits).toBeGreaterThan(0);
  expect(report.metrics.paragraphCount).toBe(0);
  expect(report.metrics.leadCount).toBe(1);
  expect(report.metrics.captionCount).toBe(1);
  expect(report.metrics.noteCount).toBe(2);
});

test("public_bullet blocks narrative, deontic, and rhetorical endings", async () => {
  const result = await runAuditExpectingExit(
    "public_bullet",
    [
      "❍ 이 사업은 단순한 도구가 아니라 변화이다.",
      "⇒ 모든 기관이 즉시 참여해야 한다.",
    ].join("\n"),
    2,
  );

  expect(result.status).toBe("BLOCKED");
  expect(result.findings.map((finding: { rule: string }) => finding.rule)).toEqual(
    expect.arrayContaining(["RHETORIC_CONTRAST", "BULLET_NARRATIVE_ENDING", "DEONTIC_CONCLUSION"]),
  );
});

test("public_plan allows measured work-plan items that compact public_bullet reviews", async () => {
  const item = "❍ (추진기반 구축) 정책 대상과 책임기관, 시행시기 및 정량 목표를 함께 제시하여 연간 실행계획의 이행 기준을 명확히 설정하고 분기별 점검체계를 운영";
  const compact = await runAudit("public_bullet", item);
  const plan = await runAudit("public_plan", item);
  expect(compact.status).toBe("REVIEW");
  expect(compact.findings.map((finding: { rule: string }) => finding.rule)).toContain("ITEM_LONG");
  expect(plan.status).toBe("PASS");
});

test("press_release allows attributed factual sentences and its measured item length", async () => {
  const report = await runAudit(
    "press_release",
    [
      "□ 국토교통부는 6월 24일 서울에서 철도의 날 기념식을 개최한다.",
      "❍ 관계기관과 산업계 관계자 400여 명이 참석하여 해외진출 전략과 철도안전 강화방안을 논의할 예정이다.",
      "❍ 장관은 \"안전을 우선하여 관련 기술개발과 현장 지원을 지속하겠다\"고 밝혔다.",
    ].join("\n"),
  );
  expect(report.status).toBe("PASS");
  expect(report.metrics.itemCount).toBe(3);
});

test("research_analytic preserves complete-sentence reasoning and detects table-only depth risk", async () => {
  const sound = await runAudit(
    "research_analytic",
    [
      "본 연구는 참여약국 20개소의 업무 기록을 분석하였다.",
      "관찰 결과는 [EVIDENCE_02]에 제시했으며, 표 3의 자료는 승인 대기시간의 분포를 보여준다.",
      "다만 표본이 한 지역에 한정되므로 결과를 전국 약국으로 일반화하는 데에는 한계가 있다.",
    ].join("\n"),
  );
  expect(sound.status).toBe("PASS");
  expect(sound.metrics.paragraphCount).toBe(3);
  expect(sound.metrics.completeSentenceParagraphRatioPermille).toBe(1000);
  expect(sound.metrics.completeAnalyticParagraphRatioPermille).toBe(1000);

  const publicResearchRegister = await runAudit(
    "research_analytic",
    [
      "본 연구의 목적은 지역별 자료 품질의 차이를 확인하는 데 있음.",
      "어떠한 평가방법을 적용하였는가? : 표본 분석과 담당자 인터뷰",
      "분석 결과는 [EVIDENCE_04]에 제시되어 있음.",
    ].join("\n"),
  );
  expect(publicResearchRegister.status).toBe("PASS");
  expect(publicResearchRegister.metrics.completeSentenceParagraphRatioPermille).toBe(667);
  expect(publicResearchRegister.findings.map((finding: { rule: string }) => finding.rule)).toContain("QUESTION_CONTEXT");

  const tableOnly = await runAudit(
    "research_analytic",
    Array.from({ length: 24 }, (_, index) => `- 절차 ${index + 1}의 운영 기준과 검토 항목 ${"세부 자료 ".repeat(7)}`).join("\n"),
  );
  expect(tableOnly.status).toBe("REVIEW");
  expect(tableOnly.findings.map((finding: { rule: string }) => finding.rule)).toContain("NO_ANALYTIC_PARAGRAPHS");

  const fragmentHeavy = await runAudit(
    "research_analytic",
    [
      "분석 대상과 범위 " + "지역별 표본과 기간별 자료를 함께 검토하는 기준 ".repeat(11),
      "자료 수집 및 정제 절차 " + "누락값과 이상치를 단계별로 확인하는 작업 항목 ".repeat(11),
      "변수 간 관계와 해석 기준 " + "관찰 결과와 인과 추론을 구분하기 위한 판단 기준 ".repeat(11),
      "한계와 후속 검증 방향 " + "[EVIDENCE_03] 표본 설계 자료와 추가 검증 범위 ".repeat(11),
    ].join("\n"),
  );
  expect(fragmentHeavy.status).toBe("REVIEW");
  expect(fragmentHeavy.findings.map((finding: { rule: string }) => finding.rule)).toContain("FRAGMENT_HEAVY_ANALYSIS");
});

test("official_form_locked excludes issuer-protected wording from normalization", async () => {
  const report = await runAudit("official_form_locked", "본인은 위 내용이 사실임을 확인합니다.", true);
  expect(report.status).toBe("NOT_APPLICABLE");
  expect(report.scope).toMatch(/protected text excluded/i);
});

async function runAudit(profile: string, contents: string, protectedText = false): Promise<any> {
  return runAuditExpectingExit(profile, contents, 0, protectedText);
}

async function runAuditExpectingExit(
  profile: string,
  contents: string,
  expectedExitCode: number,
  protectedText = false,
): Promise<any> {
  const directory = await mkdtemp(join(tmpdir(), "kpp-prose-contract-"));
  tempDirectories.push(directory);
  const inputPath = join(directory, "input.md");
  await writeFile(inputPath, contents, "utf8");
  const args = [auditorPath, inputPath, "--profile", profile];
  if (protectedText) args.push("--protected");

  try {
    const result = await execFile("python3", args, { encoding: "utf8" });
    expect(expectedExitCode).toBe(0);
    return JSON.parse(result.stdout);
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    expect(failure.code).toBe(expectedExitCode);
    return JSON.parse(failure.stdout ?? "{}");
  }
}
