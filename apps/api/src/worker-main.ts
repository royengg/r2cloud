import {FixtureExecution} from '../../../packages/adapters/src/fixture';
import {executeOne} from '../../../packages/core/src/workflow';
if(process.env.R2_MODE!=='fixture')throw new Error('An approved managed sandbox adapter is required. No host execution fallback exists.');
let stopping=false;process.on('SIGTERM',()=>stopping=true);process.on('SIGINT',()=>stopping=true);
console.log('Workflow worker · fixture execution only');
while(!stopping){try{if(!await executeOne(new FixtureExecution()))await new Promise(r=>setTimeout(r,750));}catch(e){console.error(e);await new Promise(r=>setTimeout(r,1000));}}
process.exit(0);
