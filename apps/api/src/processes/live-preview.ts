import { createPreviewGateway } from '../preview/gateway';
import { previewConnections } from '../preview/connections';
import { authorizeLivePreview, redeemLivePreview } from '@r2cloud/core/live-preview';
import { prisma } from '@r2cloud/database';

const domain = process.env.R2_PREVIEW_DOMAIN;
const token = process.env.R2_VERCEL_TOKEN;
const teamId = process.env.R2_VERCEL_TEAM_ID;
const projectId = process.env.R2_VERCEL_PROJECT_ID;
if (!domain || !token || !teamId || !projectId)
  throw new Error('Configure the isolated preview gateway environment.');
const connections = previewConnections({ token, teamId, projectId });
const gateway = createPreviewGateway(domain, {
  authorize: authorizeLivePreview,
  redeem: redeemLivePreview,
  connect: connections.connect,
});
gateway.server.listen(4311, '127.0.0.1', () =>
  console.log('Private preview gateway ready on loopback port 4311.'),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  gateway.close();
  connections.close();
  void prisma.$disconnect();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
