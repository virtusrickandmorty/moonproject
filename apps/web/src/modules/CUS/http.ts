import { ApiError, type Me } from '../../api.ts';

/** Master-data screens use the session token already held in memory by the shell. */
export async function masterRequest<T>(me: Me, path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown, version?: number): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: {
      ...(method === 'GET' ? {} : { 'x-csrf-token': me.csrfToken }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(version === undefined ? {} : { 'if-match': String(version) }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as (T & { code?: string; message?: string; details?: unknown }) | null;
  if (!response.ok) throw new ApiError(data?.code ?? `HTTP_${response.status}`, data?.message ?? 'Could not complete this request. Try again.', response.status, data?.details);
  return data as T;
}
