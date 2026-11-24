// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. A starting
// point, not a winner: it covers the watchlist, states the model and gives every protocol a farm plan.
// Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from './lib/model.ts';
import { buildRadar, dataScript, boardIssue } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const INPUT_DEFAULT = '/input/snapshot.json';
const OUTPUT_DEFAULT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

/** Resolve the input path: --input <file|dir>, else /input/snapshot.json. If dir, find snapshot.json or the single .json file. */
function resolveInput(argv: string[]): string {
  let idx = argv.indexOf('--input');
  if (idx >= 0 && idx + 1 < argv.length) {
    const p = argv[idx + 1];
    if (p.endsWith('.json') && existsSync(p)) return p;
    if (existsSync(join(p, 'snapshot.json'))) return join(p, 'snapshot.json');
    const jsons = readdirSync(p).filter(f => f.endsWith('.json'));
    if (jsons.length === 1) return join(p, jsons[0]);
    return p;
  }
  const withEq = argv.find((a) => a.startsWith('--input='));
  if (withEq) {
    const p = withEq.slice(8);
    if (p.endsWith('.json') && existsSync(p)) return p;
    if (existsSync(join(p, 'snapshot.json'))) return join(p, 'snapshot.json');
    const jsons = readdirSync(p).filter(f => f.endsWith('.json'));
    if (jsons.length === 1) return join(p, jsons[0]);
    return p;
  }
  return INPUT_DEFAULT;
}

/** Copy regular files from `from` into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputFile = resolveInput(process.argv);
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(OUTPUT_DEFAULT, { recursive: true });

// Write the ranked board as pretty JSON (2 spaces, trailing newline)
writeFileSync(join(OUTPUT_DEFAULT, 'board.json'), JSON.stringify({ rows: board }, null, 2) + '\n');

// Write the dashboard data script (exact string from dataScript, as UTF-8)
writeFileSync(join(OUTPUT_DEFAULT, 'data.js'), dataScript(radar));

// Copy dashboard directory: regular files only, creating directories as needed
copyFiles(join(here, 'dashboard'), join(OUTPUT_DEFAULT, 'dashboard'));

// Copy screenshots: regular files only
const shots = copyFiles(join(here, 'screenshots'), join(OUTPUT_DEFAULT, 'screenshots'));

// Write the dossier last (the scorer rebuilds from /output)
writeFileSync(join(OUTPUT_DEFAULT, 'dossier.json'), buildDossier(OUTPUT_DEFAULT, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `wrote ${join(OUTPUT_DEFAULT, 'board.json')}, ${join(OUTPUT_DEFAULT, 'data.js')}, ${join(OUTPUT_DEFAULT, 'dashboard')} and ${join(OUTPUT_DEFAULT, 'screenshots')} and ${join(OUTPUT_DEFAULT, 'dossier.json')}\n`,
);