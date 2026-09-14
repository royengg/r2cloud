export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
const pending = new Map<string, string>();
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const fingerprint = path + JSON.stringify(body),
    key = pending.get(fingerprint) ?? crypto.randomUUID();
  if (body !== undefined) pending.set(fingerprint, key);
  // Preserve a command key after transport loss so a retry can reconcile the same intent.
  const response = await fetch(`/api${path}`, {
    signal,
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ApiError(
      'The server returned an unexpected response. Please try again.',
      response.status,
    );
  }
  pending.delete(fingerprint);
  if (!response.ok)
    throw new ApiError(
      typeof data?.error === 'string'
        ? data.error
        : typeof data?.message === 'string'
          ? data.message
          : 'Unable to load the workspace. Try again.',
      response.status,
    );
  return data;
}
