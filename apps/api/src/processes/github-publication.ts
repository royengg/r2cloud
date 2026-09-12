import { readFile } from 'node:fs/promises';
import { GitHubPublisher } from '@r2cloud/adapters/github-publisher';
import { publishOne } from '@r2cloud/core/workflow';

const keyPath = process.env.R2_GITHUB_APP_PRIVATE_KEY_FILE;
if (!keyPath) throw Error('R2_GITHUB_APP_PRIVATE_KEY_FILE is required.');
const publisher = new GitHubPublisher({
  appId: process.env.R2_GITHUB_APP_ID ?? '',
  privateKey: await readFile(keyPath, 'utf8'),
});
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
console.log('GitHub publication worker ready');
while (!stopping) {
  try {
    if (!(await publishOne(publisher))) await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch {
    console.error('GitHub publication deferred.');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
process.exit(0);
