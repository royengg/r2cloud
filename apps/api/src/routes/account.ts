import { Router } from 'express';
import { pool } from '@r2cloud/database';
import { hash } from '@r2cloud/contracts/hash';
import { sessionToken } from '../auth/session';
import type { AppOptions } from '../config/options';
import { invitationInbox } from '@r2cloud/core/team';
import { projects } from '@r2cloud/core/service';
export function accountRoutes(options: AppOptions) {
  const router = Router();
  router.get('/me', async (req, res) => {
    const actor = res.locals.actor;
    const user = (await pool.query('SELECT id,name,kind FROM users WHERE id=$1', [actor.id]))
      .rows[0];
    res.json({
      user,
      invitations: await invitationInbox(actor),
      projects: await projects(actor),
      mode: options.fixture ? 'fixture' : 'managed',
      authMode: options.identity?.mode ?? 'fixture',
    });
  });
  router.post('/logout', async (req, res) => {
    if (options.identity) return options.identity.signOut(req, res);
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [
      hash(sessionToken(req.headers.cookie)),
    ]);
    res.clearCookie('r2session');
    res.json({ ok: true });
  });
  return router;
}
