/**
 * Every error the API returns has a stable code and a plain-English message for staff.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
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
