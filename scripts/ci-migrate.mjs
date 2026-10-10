// Runs at the end of `pnpm run build`. Only inside Workers Builds (WORKERS_CI=1) does it apply pending
// D1 migrations to the top-level database in wrangler.jsonc, before the deploy command uploads new code.
// Locally and in tests it does nothing. Set RHYME_SKIP_REMOTE_MIGRATIONS=1 on a trigger to opt out.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.env.WORKERS_CI !== '1') process.exit(0);
if (process.env.RHYME_SKIP_REMOTE_MIGRATIONS === '1') {
  console.log('D1 migrations skipped: RHYME_SKIP_REMOTE_MIGRATIONS=1');
  process.exit(0);
}
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const command = ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.jsonc'];
console.log(`Applying pending D1 migrations (branch ${process.env.WORKERS_CI_BRANCH || 'unknown'}): wrangler ${command.join(' ')}`);
const result = spawnSync(process.execPath, [wrangler, ...command], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
if (result.status !== 0) {
  console.error('D1 migrations failed, so this build stops before deploying code that expects them.');
  console.error('If the build token lacks D1 edit permission, run once from a trusted machine: pnpm exec wrangler d1 migrations apply DB --remote');
  process.exit(result.status || 1);
}
