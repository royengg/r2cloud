export function snapshotSession(state: string, providerId: string, tools: unknown[]) {
  const end = state.lastIndexOf('\n');
  if (!state.endsWith('\n')) {
    try {
      JSON.parse(state.slice(end + 1));
    } catch {
      state = state.slice(0, end + 1);
    }
  }
  return restoreSessionTools(state, providerId, tools);
}

export function restoreSessionTools(state: string, providerId: string, tools: unknown[]) {
  let found = false;
  const lines = state.split('\n').map((line) => {
    if (!line.trim()) return line;
    const item = JSON.parse(line);
    if (item.type !== 'session_meta') return line;
    if (found || item.payload?.id !== providerId)
      throw new Error('Saved Codex session metadata is invalid.');
    found = true;
    return JSON.stringify({ ...item, payload: { ...item.payload, dynamic_tools: tools } });
  });
  if (!found) throw new Error('Saved Codex session metadata is missing.');
  return lines.join('\n');
}
