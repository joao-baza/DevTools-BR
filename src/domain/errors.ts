export type ErrorCode = "invalid_parameter" | "invalid_input" | "internal_error" | "cep_database_unavailable";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    field?: string;
  };
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, field?: string, statusCode = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.field = field;
    this.statusCode = statusCode;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.field ? { field: this.field } : {})
      }
    };
  }
}
