import type { DocumentMode } from "@longtable/kpp-schemas";

const SHA256 = /^[a-f0-9]{64}$/u;
const PAGE_LOCATOR = /^page:\d{4}$/u;

export interface RenderTitleBlockObservation {
  textFingerprint: string;
  pointSize: number;
  region: "top" | "body" | "bottom";
}

export interface RenderPageGeometry {
  widthPoint: number;
  heightPoint: number;
  textBlockCount: number;
  tableCount: number;
  figureCount: number;
}

export interface RenderContinuationMarkers {
  fromPrevious: boolean;
  toNext: boolean;
}

/** Observed from rendered/OOXML bytes. Deliberately contains no planned page role. */
export interface RenderPageObservation {
  pageNumber: number;
  pageLocator: string;
  sourceArtifactSha256: string;
  measuredHeadingPointSizes: number[];
  titleBlocks: RenderTitleBlockObservation[];
  surfaceFamily: string;
  regionFingerprints: string[];
  geometry: RenderPageGeometry;
  continuationMarkers: RenderContinuationMarkers;
}

export interface RenderObservationManifest {
  schemaVersion: "1.0.0";
  projectId: string;
  documentMode: DocumentMode;
  modePolicyVersion: string;
  sourceArtifact: {
    path: string;
    sha256: string;
    bytes: number;
  };
  pages: RenderPageObservation[];
}

export interface RenderObservationIdentity {
  projectId: string;
  documentMode: DocumentMode;
  modePolicyVersion: string;
}

export function renderObservationManifestFromGeometry(
  geometryReport: unknown,
  identity: RenderObservationIdentity,
): RenderObservationManifest {
  const report = asRecord(geometryReport, "geometry report");
  const docx = asRecord(report.docx, "geometry report docx");
  const sourceArtifact = {
    path: requiredString(docx.path, "geometry report docx path"),
    sha256: requiredSha(docx.sha256, "geometry report docx sha256"),
    bytes: requiredNonnegativeInteger(docx.bytes, "geometry report docx bytes", true),
  };
  if (!Array.isArray(report.pageObservations) || report.pageObservations.length === 0) {
    throw new Error("geometry report page observations are missing");
  }
  const pages = report.pageObservations.map((value, index) =>
    parsePageObservation(value, index, sourceArtifact.sha256));
  const pageNumbers = pages.map(({ pageNumber }) => pageNumber);
  if (new Set(pageNumbers).size !== pageNumbers.length
    || pageNumbers.some((pageNumber, index) => pageNumber !== index + 1)) {
    throw new Error("page observations must be ordered, unique, and contiguous");
  }
  return {
    schemaVersion: "1.0.0",
    projectId: requiredString(identity.projectId, "projectId"),
    documentMode: identity.documentMode,
    modePolicyVersion: requiredString(identity.modePolicyVersion, "modePolicyVersion"),
    sourceArtifact,
    pages,
  };
}

function parsePageObservation(
  value: unknown,
  index: number,
  sourceArtifactSha256: string,
): RenderPageObservation {
  const page = asRecord(value, `page observation ${index + 1}`);
  const pageNumber = requiredNonnegativeInteger(page.pageNumber, "page observation number", true);
  const pageLocator = requiredString(page.pageLocator, "page observation locator");
  if (!PAGE_LOCATOR.test(pageLocator)
    || pageLocator !== `page:${String(pageNumber).padStart(4, "0")}`) {
    throw new Error("page observation locator must be the stable page:NNNN form");
  }
  const observedSourceSha256 = requiredSha(
    page.sourceArtifactSha256,
    "page observation source artifact sha256",
  );
  if (observedSourceSha256 !== sourceArtifactSha256) {
    throw new Error("page observation source artifact sha256 does not match the geometry report");
  }
  const measuredHeadingPointSizes = numberArray(page.measuredHeadingPointSizes, "measured heading sizes");
  const titleBlocks = array(page.titleBlocks, "title blocks").map((title, titleIndex) => {
    const block = asRecord(title, `title block ${titleIndex + 1}`);
    const rawRegion = requiredString(block.region, "title block region");
    if (rawRegion !== "top" && rawRegion !== "body" && rawRegion !== "bottom") {
      throw new Error("title block region is invalid");
    }
    const region: RenderTitleBlockObservation["region"] = rawRegion;
    return {
      textFingerprint: requiredSha(block.textFingerprint, "title block fingerprint"),
      pointSize: requiredPositiveNumber(block.pointSize, "title block point size"),
      region,
    };
  });
  const geometry = asRecord(page.geometry, "page observation geometry");
  const markers = asRecord(page.continuationMarkers, "page continuation markers");
  return {
    pageNumber,
    pageLocator,
    sourceArtifactSha256,
    measuredHeadingPointSizes,
    titleBlocks,
    surfaceFamily: requiredString(page.surfaceFamily, "surface family"),
    regionFingerprints: array(page.regionFingerprints, "region fingerprints")
      .map((fingerprint) => requiredSha(fingerprint, "region fingerprint")),
    geometry: {
      widthPoint: requiredPositiveNumber(geometry.widthPoint, "page width"),
      heightPoint: requiredPositiveNumber(geometry.heightPoint, "page height"),
      textBlockCount: requiredNonnegativeInteger(geometry.textBlockCount, "text block count"),
      tableCount: requiredNonnegativeInteger(geometry.tableCount, "table count"),
      figureCount: requiredNonnegativeInteger(geometry.figureCount, "figure count"),
    },
    continuationMarkers: {
      fromPrevious: requiredBoolean(markers.fromPrevious, "fromPrevious marker"),
      toNext: requiredBoolean(markers.toNext, "toNext marker"),
    },
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function numberArray(value: unknown, label: string): number[] {
  return array(value, label).map((item) => requiredPositiveNumber(item, label));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is missing`);
  return value;
}

function requiredSha(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!SHA256.test(result)) throw new Error(`${label} must be a lowercase SHA-256`);
  return result;
}

function requiredPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function requiredNonnegativeInteger(value: unknown, label: string, positive = false): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`${label} must be ${positive ? "a positive" : "a nonnegative"} integer`);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}
