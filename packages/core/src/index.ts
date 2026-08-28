export { KppError, type KppErrorDetails } from "./errors.js";
export { sha256File } from "./hash.js";
export {
  extractRequirementCandidates,
  extractRequirementCandidatesFile,
  extractTextDocument,
  writeRequirementCandidates,
  type ExtractedTextDocument,
  type TextExtractionOptions,
} from "./rfp-candidates.js";
export {
  type ExtractedTextPage,
  type TextExtractionRunner,
} from "./text-extraction.js";
export {
  initializeProject,
  PROJECT_DIRECTORIES,
  persistProjectState,
  projectPath,
  readProject,
  PROJECT_FILE_NAME,
  type ProjectInitialization,
} from "./project-store.js";
export {
  DOCUMENT_MODES,
  type DocumentMode,
  type ProposalClass,
} from "@longtable/kpp-schemas";
export {
  getDocumentModePolicy,
  MODE_POLICY_VERSION,
  type DocumentModePolicy,
} from "./mode-policy.js";
export {
  validatePageArchitecture,
  type ValidationEvidence,
  type ValidationFinding,
  type ValidationResult,
} from "./page-architecture.js";
export { validateReferenceManifest } from "./reference-integrity.js";
export {
  migrateProject,
  type MigrateProjectOptions,
  type MigrationReport,
} from "./migration.js";
export {
  advanceProject,
  allowedNext,
  PROJECT_STATES,
  verifyProjectState,
} from "./state-machine.js";
export {
  verifyReceipt,
  writeReceipt,
  type ReceiptInput,
  type ReceiptVerification,
  type ReceiptVerificationMismatch,
} from "./receipts.js";
export {
  lockRequirements,
  type RequirementLockInput,
  type RequirementLockResult,
} from "./requirement-lock.js";
export {
  exportAuthoring,
  importAuthoring,
  verifyImportedAuthoringResponse,
  type AuthoringSourceInput,
  type ExportAuthoringInput,
  type ExportAuthoringResult,
  type ImportAuthoringResult,
  type VerifiedAuthoringResponse,
} from "./authoring-bundle.js";
export { planFigure } from "./figure-planner.js";
export {
  createTopologyStudyRequest,
  validateVisualSourcePacket,
  type TopologyStudyInput,
  type ValidatedVisualSourcePacket,
} from "./visual-source-gate.js";
export {
  importResearchLock,
  type ResearchLockImportResult,
} from "./research-lock.js";
export {
  getResearchLockReceiptHash,
  requiresResearchLock,
  verifyResearchRequirement,
} from "./research-requirement.js";
export {
  executeFile,
  resolveVerifiedExecutable,
  type ExecutableIdentity,
  type ExecuteFileInput,
  type ExecuteFileResult,
  type ResolveExecutableInput,
} from "./os-adapters.js";
