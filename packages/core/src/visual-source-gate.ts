import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  LockedResearchLogicSchema,
  SemanticFigureSpecSchema,
  TopologyStudyRequestSchema,
  VisualSourcePacketSchema,
  type LockedResearchLogic,
  type SemanticFigureSpec,
  type TopologyStudyRequest,
  type VisualSourcePacket,
} from "@kpp/schemas";
import { KppError } from "./errors.js";
import { sha256File } from "./hash.js";

const REFERENCE_PAGE_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

export interface ValidatedVisualSourcePacket extends VisualSourcePacket {
  readonly packetSha256: string;
}

export interface TopologyStudyInput {
  readonly figure: SemanticFigureSpec;
  readonly visualSourcePacket: unknown;
  readonly researchLogic: unknown;
  readonly directFinalUse: boolean;
}

/**
 * Confirms the source packet is made of attached, Korean, rights-declared
 * pages whose inspected hashes still match the local files. It validates
 * source material only; it never promotes those pages to final figure data.
 */
export async function validateVisualSourcePacket(input: unknown): Promise<ValidatedVisualSourcePacket> {
  const packet = parseVisualSourcePacket(input);
  const canonicalPacket: VisualSourcePacket = {
    ...packet,
    referencePages: packet.referencePages.map((page) => ({
      ...page,
      path: resolve(page.path),
    })),
  };
  await Promise.all(canonicalPacket.referencePages.map(validateReferencePage));
  return {
    ...canonicalPacket,
    packetSha256: sha256CanonicalJson(canonicalPacket),
  };
}

/**
 * Emits a strictly provisional topology-study request for a locked academic
 * framework. The response is composition-only and must be rebuilt by the
 * deterministic renderer named in the semantic figure specification.
 */
export async function createTopologyStudyRequest(input: TopologyStudyInput): Promise<TopologyStudyRequest> {
  if (input.directFinalUse) {
    throw new KppError(
      "KPP_DESIGN_TOPOLOGY_FINAL_USE",
      "ImageGen 결과는 최종 도식이나 근거로 직접 사용할 수 없습니다.",
      { rule: "topology_study_direct_final_use", actual: input.directFinalUse },
    );
  }
  const figure = parseSemanticFigureSpec(input.figure);
  if (figure.family !== "framework" || figure.renderer !== "svg-academic-framework") {
    throw new KppError(
      "KPP_DESIGN_TOPOLOGY_FAMILY",
      "토폴로지 연구 요청은 잠긴 학술 프레임워크에만 사용할 수 있습니다.",
      { rule: "topology_study_framework_only", actual: figure.family },
    );
  }

  const [packet, researchLogic] = await Promise.all([
    validateVisualSourcePacket(input.visualSourcePacket),
    validateLockedResearchLogic(input.researchLogic),
  ]);
  return TopologyStudyRequestSchema.parse({
    studyId: `topology-${figure.figureId}-${packet.packetSha256.slice(0, 12)}`,
    figureId: figure.figureId,
    family: "framework",
    renderer: "svg-academic-framework",
    sourcePacketSha256: packet.packetSha256,
    referencePages: packet.referencePages,
    researchLogic,
    status: "composition_candidate",
    directFinalUse: false,
    finalEvidenceAllowed: false,
    topologyOnly: true,
  });
}

function parseSemanticFigureSpec(value: unknown): SemanticFigureSpec {
  const parsed = SemanticFigureSpecSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_FIGURE_INVALID", "토폴로지 연구 대상 도식 형식이 올바르지 않습니다.", {
    rule: "semantic_figure_spec_schema",
    actual: parsed.error.issues,
  });
}

function parseVisualSourcePacket(value: unknown): VisualSourcePacket {
  const parsed = VisualSourcePacketSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new KppError("KPP_INPUT_VISUAL_SOURCE_INVALID", "시각 기준 자료 패킷 형식이 올바르지 않습니다.", {
    rule: "visual_source_packet_schema",
    actual: parsed.error.issues,
  });
}

async function validateReferencePage(page: VisualSourcePacket["referencePages"][number]): Promise<void> {
  const path = resolve(page.path);
  const extension = extname(path).toLowerCase();
  if (!REFERENCE_PAGE_EXTENSIONS.has(extension)) {
    throw new KppError("KPP_INPUT_VISUAL_SOURCE_UNVERIFIED", "첨부된 한국어 기준 페이지 형식이 허용되지 않습니다.", {
      rule: "visual_reference_page_extension",
      path,
      expected: [...REFERENCE_PAGE_EXTENSIONS],
      actual: extension,
    });
  }
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error("reference page is not a non-empty file");
    }
    const actualSha256 = await sha256File(path);
    if (actualSha256 !== page.sha256) {
      throw new KppError("KPP_INPUT_VISUAL_SOURCE_UNVERIFIED", "시각 기준 페이지의 검사 해시가 일치하지 않습니다.", {
        rule: "visual_reference_page_sha256",
        path,
        expected: page.sha256,
        actual: actualSha256,
      });
    }
  } catch (error) {
    if (error instanceof KppError) {
      throw error;
    }
    throw new KppError("KPP_INPUT_VISUAL_SOURCE_UNVERIFIED", "시각 기준 페이지를 확인할 수 없습니다.", {
      rule: "visual_reference_page_file",
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
}

async function validateLockedResearchLogic(value: unknown): Promise<LockedResearchLogic> {
  const parsed = LockedResearchLogicSchema.safeParse(value);
  if (!parsed.success) {
    throw new KppError("KPP_INPUT_RESEARCH_LOGIC_INVALID", "잠긴 연구 논리 형식이 올바르지 않습니다.", {
      rule: "locked_research_logic_schema",
      actual: parsed.error.issues,
    });
  }
  const path = resolve(parsed.data.path);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error("research logic is not a non-empty file");
    }
    const actualSha256 = await sha256File(path);
    if (actualSha256 !== parsed.data.sha256) {
      throw new KppError("KPP_INPUT_RESEARCH_LOGIC_UNVERIFIED", "잠긴 연구 논리의 검사 해시가 일치하지 않습니다.", {
        rule: "research_logic_sha256",
        path,
        expected: parsed.data.sha256,
        actual: actualSha256,
      });
    }
  } catch (error) {
    if (error instanceof KppError) {
      throw error;
    }
    throw new KppError("KPP_INPUT_RESEARCH_LOGIC_UNVERIFIED", "잠긴 연구 논리를 확인할 수 없습니다.", {
      rule: "research_logic_file",
      path,
      actual: error instanceof Error ? error.message : error,
    });
  }
  return { ...parsed.data, path };
}

function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]));
  }
  return value;
}
