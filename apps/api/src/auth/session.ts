import type { IncomingHttpHeaders } from 'node:http';
import type { AppOptions } from '../config/options';
import { requireThat } from '@r2cloud/contracts/domain';
export function requestActor(options: AppOptions, headers: IncomingHttpHeaders) {
  requireThat(options.identity, 401, 'Sign in with GitHub to continue.');
  return options.identity.authenticate(headers);
}
