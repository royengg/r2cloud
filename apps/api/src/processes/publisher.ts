import { FixturePublisher } from '@r2cloud/adapters/fixture';
import { publishOne } from '@r2cloud/core/workflow';
if (process.env.R2_MODE !== 'fixture')
  throw new Error('The isolated GitHub publisher is not configured. No publication will occur.');
let stopping = false;
process.on('SIGTERM', () => (stopping = true));
process.on('SIGINT', () => (stopping = true));
console.log('Publisher · fixture repository only');
while (!stopping) {
  try {
    if (!(await publishOne(new FixturePublisher()))) await new Promise((r) => setTimeout(r, 750));
  } catch (e) {
    console.error(e);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
process.exit(0);
