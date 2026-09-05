const pending = new Map<string, string>();
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const fingerprint = path + JSON.stringify(body),
    key = pending.get(fingerprint) ?? crypto.randomUUID();
  if (body !== undefined) pending.set(fingerprint, key);
  // Preserve a command key after transport loss so a retry can reconcile the same intent.
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  pending.delete(fingerprint);
  if (!response.ok) throw new Error(data.error ?? 'Unable to load the workspace. Try again.');
  return data;
}
