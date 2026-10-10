import { spawn } from 'node:child_process';
import path from 'node:path';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {url,token}=JSON.parse(input);
if(!url.startsWith('https://rhyme-community-staging.'))throw new Error('线上测试只能运行在 staging');
const child=spawn(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),'--test','tests/api.test.ts'],{stdio:'inherit',env:{...process.env,TEST_URL:url,TEST_BOOTSTRAP_TOKEN:token}});
child.on('exit',code=>process.exit(code||0));
