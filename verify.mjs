import { readFileSync } from 'fs';

// Read the data and board files
const dataJs = readFileSync('/home/vasa/.config/freebuff-desktop/local-projects/d6c2a625-a4f5-4973-b82f-63b49183f2ba/.earn/out/data.js', 'utf8');
const boardJson = readFileSync('/home/vasa/.config/freebuff-desktop/local-projects/d6c2a625-a4f5-4973-b82f-63b49183f2ba/.earn/out/board.json', 'utf8');

// Parse data and board
const data = JSON.parse(dataJs.replace(/^window\.RADAR=/, ''));

// Verify data.js has complete model on each row
let bad = 0;
for (const row of data.rows) {
  if (typeof row.rationale !== 'string' || row.rationale.trim() === '') {
    console.log('BAD rationale:', row.slug);
    bad++;
  }
  if (typeof row.model !== 'object' || row.model === null) {
    console.log('BAD model:', row.slug);
    bad++;
    continue;
  }
  // Check all required model fields exist and are numbers
  const required = ['category_multiple', 'chain_premium', 'growth_factor', 'maturity_factor', 'scale_factor', 'category_peer_count', 'blue_chip_chains', 'total_chains', 'growth_pct', 'age_days', 'tvl_usd'];
  for (const k of required) {
    if (typeof row.model[k] !== 'number' || !Number.isFinite(row.model[k])) {
      console.log('BAD model.' + k + ':', row.slug, row.model[k]);
      bad++;
    }
  }
}

// Verify farm steps in board.json are valid
for (const row of JSON.parse(boardJson).rows) {
  if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
    console.log('BAD farm_steps count:', r.slug, r.farm_steps?.length);
    bad++;
  }
  for (const s of row.farm_steps) {
    if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) {
      console.log('BAD farm step length:', r.slug, s?.length);
      bad++;
    }
  }
}

// Print summary
console.log('rows:', data.rows.length, 'board rows:', boardJson.rows.length);
console.log('sample rationale:', data.rows[0].rationale.slice(0, 80));
console.log('sample farm steps:', data.rows[0].farm_steps.slice(0, 3).map(s => s.slice(0, 80)));
console.log('problems:', bad);
process.exit(bad === 0 ? 0 : 1);