import { useCallback, useEffect, useState } from 'react';
import type { LibraryErrorBody } from '@headunit/shared';

export interface ApiError {
  message: string;
  code?: LibraryErrorBody['code'];
}

interface ApiState<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
}

/** GET a JSON route; refetches when `path` or `refreshKey` changes. Pass null to stay idle. */
export function useApi<T>(path: string | null, refreshKey?: unknown) {
  const [state, setState] = useState<ApiState<T>>({ loading: path !== null });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetch(path)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as T & Partial<LibraryErrorBody>;
        if (!live) return;
        if (!r.ok) setState({ loading: false, error: { message: body.error ?? `Error ${r.status}`, code: body.code } });
        else setState({ loading: false, data: body });
      })
      .catch(() => live && setState({ loading: false, error: { message: 'Can’t reach the head unit' } }));
    return () => {
      live = false;
    };
  }, [path, refreshKey, n]);

  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
}

export type ApiMethod = 'POST' | 'PUT' | 'DELETE';

/** An error from the head unit's API, carrying its plain-language message (and library error code, if any). */
export class ApiRequestError extends Error {
  code?: LibraryErrorBody['code'];
  constructor(message: string, code?: LibraryErrorBody['code']) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

async function send<T>(path: string, method: 'GET' | ApiMethod, body?: unknown): Promise<{ data?: T; error?: ApiError }> {
  try {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(path, init);
    const json = (await r.json().catch(() => ({}))) as T & Partial<LibraryErrorBody>;
    if (r.ok) return { data: json };
    return { error: { message: typeof json.error === 'string' && json.error ? json.error : `Error ${r.status}`, code: json.code } };
  } catch {
    return { error: { message: 'Can’t reach the head unit' } };
  }
}

/** POST/PUT/DELETE JSON (the body is optional). Resolves with the parsed body or a friendly error — never throws. */
export function apiSend<T = unknown>(path: string, body?: unknown, method: ApiMethod = 'POST'): Promise<{ data?: T; error?: ApiError }> {
  return send<T>(path, method, body);
}

/** Like `apiSend` (and GET too), but resolves with the body and throws an `ApiRequestError` carrying the server's `{error}` message. */
export async function apiRequest<T>(path: string, method: 'GET' | ApiMethod = 'GET', body?: unknown): Promise<T> {
  const r = await send<T>(path, method, body);
  if (r.error) throw new ApiRequestError(r.error.message, r.error.code);
  return r.data as T;
}
