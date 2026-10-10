// Writes wrangler.ya.json from wrangler.jsonc so an older Workers Builds
// deploy command that still does `npx wrangler deploy -c wrangler.ya.json`
// keeps working. wrangler.jsonc is already the production config
// (rhyme-community-ya / ya.zoci.pro); this copy just drops $schema.
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('wrangler.jsonc', 'utf8');
const config = JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
delete config.$schema;
delete config.env;
config.name = 'rhyme-community-ya';
config.workers_dev = false;
config.routes = [{ pattern: 'ya.zoci.pro', custom_domain: true }];
writeFileSync('wrangler.ya.json', JSON.stringify(config, null, 2));
