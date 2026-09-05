import { randomUUID } from 'node:crypto';
/** Mock only GitHub HTTP endpoints. Real Better Auth state, callback, session and DB code still runs. */
export function mockGitHub() {
  const original = globalThis.fetch;
  const codes = new Map<string, { id: string; email: string; verified: boolean }>();
  const tokens = new Map<string, { id: string; email: string; verified: boolean }>();
  let calls = 0;
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token') {
        calls++;
        const text = await request.text();
        const body = text.startsWith('{')
          ? JSON.parse(text)
          : Object.fromEntries(new URLSearchParams(text));
        const profile = codes.get(body.code);
        codes.delete(body.code);
        if (!profile) return Response.json({ error: 'bad_verification_code' });
        const token = 'fixture-identity-token-' + randomUUID();
        tokens.set(token, profile);
        return Response.json({
          access_token: token,
          token_type: 'bearer',
          scope: 'read:user,user:email',
        });
      }
      if (url.origin === 'https://api.github.com') {
        calls++;
        const profile = tokens.get(
          (request.headers.get('authorization') ?? '').replace(/^Bearer /i, ''),
        );
        if (!profile) return Response.json({ message: 'Bad credentials' }, { status: 401 });
        if (url.pathname === '/user')
          return Response.json({
            id: profile.id,
            login: 'founder',
            name: 'New founder',
            email: null,
            avatar_url: null,
          });
        if (url.pathname === '/user/emails')
          return Response.json([
            { email: profile.email, primary: true, verified: profile.verified },
          ]);
        throw Error('Unexpected GitHub request: ' + url.pathname);
      }
      return original(input, init);
    },
    { preconnect: original.preconnect },
  ) as typeof fetch;
  return {
    issue(input: { email?: string; verified?: boolean; id?: string } = {}) {
      const code = 'fixture-code-' + randomUUID();
      codes.set(code, {
        id: input.id ?? randomUUID(),
        email: input.email ?? randomUUID() + '@example.test',
        verified: input.verified ?? true,
      });
      return code;
    },
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}
