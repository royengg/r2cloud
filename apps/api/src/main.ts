import { createHttpServer } from './app';
if (process.env.R2_MODE !== 'fixture')
  throw new Error(
    'Managed mode requires product sign-in, sandbox, preview, storage and GitHub adapters. Fixture login is never enabled implicitly.',
  );
const { server } = createHttpServer({ fixture: true });
server.listen(4310, '127.0.0.1', () =>
  console.log('R2Cloud API · local fixture mode · http://127.0.0.1:4310'),
);
