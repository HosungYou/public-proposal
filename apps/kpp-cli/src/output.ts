import { KppError } from "@kpp/core";

export interface CliEnvelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly data: unknown;
}

export function success(message: string, data: unknown): CliEnvelope {
  return { ok: true, code: "KPP_OK", message, data };
}

export function failure(error: unknown): CliEnvelope {
  if (error instanceof KppError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      data: error.details,
    };
  }

  return {
    ok: false,
    code: "KPP_INPUT_COMMAND",
    message: "명령어 입력이 올바르지 않습니다.",
    data: {
      actual: error instanceof Error ? error.message : String(error),
    },
  };
}

export function writeEnvelope(envelope: CliEnvelope, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }

  process.stdout.write(`${envelope.message}\n`);
}
