import { betterAuth } from 'better-auth/minimal';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type { Express, Request, Response as ExpressResponse } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { prisma } from '@r2cloud/database';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';

export interface ProductIdentity {
  mode: 'better-auth';
  origin: string;
  provider: 'github';
  mount(app: Express): void;
  authenticate(headers: IncomingHttpHeaders): Promise<Actor>;
  signOut(req: Request, res: ExpressResponse): Promise<void>;
}
export function createIdentity(config: {
  baseURL: string;
  secret: string;
  githubClientId: string;
  githubClientSecret: string;
}) {
  const base = new URL(config.baseURL);
  if (
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)))
  )
    throw new Error('Auth requires an exact HTTPS origin (HTTP is allowed only on loopback).');
  if (config.secret.length < 32)
    throw new Error('A dedicated authentication secret of at least 32 characters is required.');
  if (!config.githubClientId || !config.githubClientSecret)
    throw new Error('GitHub sign-in requires an OAuth client ID and secret.');
  const auth = betterAuth({
    appName: 'R2Cloud',
    baseURL: base.origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [base.origin],
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    user: { modelName: 'authUser' },
    session: {
      modelName: 'authSession',
      expiresIn: 8 * 3600,
      updateAge: 3600,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'authAccount',
      identityStrategy: 'provider-id',
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    verification: { modelName: 'authVerification' },
    socialProviders: {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        disableDefaultScope: true,
        scope: ['read:user', 'user:email'],
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === '/sign-in/social' &&
          (ctx.body?.provider !== 'github' ||
            ctx.body?.scopes?.some((scope: string) => !['read:user', 'user:email'].includes(scope)))
        )
          throw new APIError('BAD_REQUEST', {
            message: 'Product sign-in only requests GitHub profile and email access.',
          });
      }),
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'authRateLimit',
      window: 60,
      max: 100,
      customRules: { '/sign-in/social': { window: 60, max: 10 } },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-r2-client-ip'] },
      cookiePrefix: 'r2auth',
      useSecureCookies: base.protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
  });
  const identity: ProductIdentity = {
    mode: 'better-auth',
    origin: base.origin,
    provider: 'github',
    mount(app) {
      app.use('/api/auth', (req, res, next) => {
        // Overwrite client input. Proxy-aware forwarding needs an explicit deployment policy.
        req.headers['x-r2-client-ip'] = req.socket.remoteAddress ?? '127.0.0.1';
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== base.origin)
          return res.status(403).json({ error: 'Request origin is not permitted.' });
        next();
      });
      app.all('/api/auth/*splat', toNodeHandler(auth));
    },
    async authenticate(headers) {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(headers),
        query: { disableCookieCache: true },
      });
      requireThat(session?.user.emailVerified, 401, 'Sign in with a verified account.');
      // Stable provider ID mapping, never email matching or client-supplied actor/role fields.
      const user = await prisma.users.upsert({
        where: { auth_user_id: session.user.id },
        create: {
          id: 'person:' + session.user.id,
          name: session.user.name,
          kind: 'human',
          auth_user_id: session.user.id,
        },
        update: { name: session.user.name },
        select: { id: true, kind: true },
      });
      requireThat(user.kind === 'human', 403, 'Product sign-in is reserved for people.');
      return { id: user.id, kind: user.kind };
    },
    async signOut(req, res) {
      const response = await auth.api.signOut({
        headers: fromNodeHeaders(req.headers),
        asResponse: true,
      });
      for (const cookie of response.headers.getSetCookie()) res.append('Set-Cookie', cookie);
      res
        .status(response.status)
        .type('json')
        .send(await response.text());
    },
  };
  return { auth, identity };
}
