import { Router } from 'express';
import { requireThat } from '@r2cloud/contracts/domain';
import { id, hash } from '@r2cloud/contracts/hash';
import { pool } from '@r2cloud/database';
export function fixtureRoutes() {
  const router = Router();
  router.post('/local-session', async (req, res) => {
    requireThat(
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''),
      403,
      'Local fixture access only.',
    );
    requireThat(
      ['maya', 'alex', 'sam'].includes(req.body.userId),
      400,
      'Select a fixture participant.',
    );
    const token = id() + id();
    await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '8 hours')", [
      hash(token),
      req.body.userId,
    ]);
    res.cookie('r2session', token, {
      httpOnly: true,
      secure: Boolean(process.env.R2_DEV_ORIGIN),
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 3600 * 1000,
    });
    res.json({ fixture: true });
  });
  return router;
}
