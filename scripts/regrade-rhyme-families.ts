import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare } from '../shared/rhyme.ts';
import type { Syllable } from '../shared/rhyme.ts';

const env = process.argv[2];
if (env !== 'staging' && env !== 'production') throw new Error('Specify staging or production; optionally append --apply');
const apply = process.argv.includes('--apply');
const environment = env === 'production' ? '' : 'staging';
function execute(args: string[]) {
  const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--remote', `--env=${environment}`, '--json', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  // File execution may include upload progress on stdout even with --json.
  // Its result is verified with a separate read query below.
  if (args.includes('--file')) return [];
  const data = JSON.parse(r.stdout);
  if (!data.every((x: {success:boolean}) => x.success)) throw new Error('Database execution failed');
  return data;
}
type Row = { id:string; kind:string; points:number; topic_readings:string; answer_readings:string };
function records(): Row[] {
  return execute(['--command', 'SELECT a.id,a.kind,a.points,t.readings AS topic_readings,a.readings AS answer_readings FROM answers a JOIN topics t ON t.id=a.topic_id ORDER BY a.id'])[0].results;
}
const changes = records().flatMap(row => {
  const next = compare(JSON.parse(row.topic_readings) as Syllable[], JSON.parse(row.answer_readings) as Syllable[]);
  if (!next.valid) throw new Error(`Stored answer ${row.id} became invalid; aborting`);
  return row.kind === next.kind && row.points === next.points ? [] : [{id:row.id, before:{kind:row.kind,points:row.points}, after:{kind:next.kind,points:next.points}}];
});
if (apply && changes.length) {
  const quote = (s:string) => `'${s.replace(/'/g,"''")}'`;
  const folder = mkdtempSync(join(tmpdir(), 'rhyme-regrade-'));
  try {
    const path = join(folder, 'updates.sql');
    // Compare-and-set touches classification and points only. Never release uniqueness
    // or modify authors, readings, timestamps, or withdrawn states.
    writeFileSync(path, changes.map(c => `UPDATE answers SET kind=${quote(c.after.kind)},points=${c.after.points} WHERE id=${quote(c.id)} AND kind=${quote(c.before.kind)} AND points=${c.before.points};`).join('\n'));
    execute(['--file', path]);
    const verified = new Map(records().map(row => [row.id, row]));
    for (const change of changes) {
      const row = verified.get(change.id);
      if (!row || row.kind !== change.after.kind || row.points !== change.after.points) throw new Error(`Regrade verification failed for ${change.id}`);
    }
  } finally { rmSync(folder, {recursive:true,force:true}); }
}
console.log(JSON.stringify({environment:env, applied:apply, changed:changes.length, changes},null,2));
