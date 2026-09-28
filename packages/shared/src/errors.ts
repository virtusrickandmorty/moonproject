/**
 * Every error the API returns has a stable code and a plain-English message for staff.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(code, msg, 400, details);
export const unauthorized = (msg = 'Please sign in again.') => new AppError('AUTH_REQUIRED', msg, 401);
export const forbidden = (perm: string) =>
  new AppError('FORBIDDEN', 'You do not have permission to do this. Ask an owner.', 403, { permission: perm });
export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found.`, 404);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(code, msg, 409, details);

export interface Issue {
  field?: string;
  code: string;
  message: string;
  /** 'error' blocks posting; 'warning' is shown but allowed. */
  level: 'error' | 'warning';
}
