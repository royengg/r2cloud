import {defineConfig} from 'prisma/config';
import {resolve} from 'node:path';
const local=`postgresql://${process.env.USER??'paseo-agent'}@localhost:55439/postgres?host=${encodeURIComponent(resolve('.local/pgsocket'))}`;
export default defineConfig({schema:'packages/database/prisma/schema.prisma',migrations:{path:'packages/database/prisma/migrations'},datasource:{url:process.env.DIRECT_URL??process.env.DATABASE_URL??local}});
