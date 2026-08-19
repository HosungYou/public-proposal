export interface KppErrorDetails {
  actual?: unknown;
  changed?: unknown;
  expected?: unknown;
  path?: string;
  rule?: string;
  stage?: string;
}

export class KppError extends Error {
  readonly code: string;
  readonly details: KppErrorDetails;

  constructor(code: string, message: string, details: KppErrorDetails = {}) {
    super(message);
    this.name = "KppError";
    this.code = code;
    this.details = details;
  }
}
