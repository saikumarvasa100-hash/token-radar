// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   category_multiple = median mcap/tvl of token-bearing protocols in this category (from snapshot)
//   chain_premium     = 1 + 0.05 * min(blue_chip_chains, 3) + 0.02 * max(total_chains - 1, 0)
//   growth_factor     = 1 + clamp(change_7d, -50, 100) / 100 * 0.3
//   maturity_factor   = 0.6 + 0.4 * min(age_days, 1095) / 1095    (age_days unknown: 365)
//   scale_factor      = 1 / (1 + 0.1 * max(log10(tvl_usd / 1e8), 0))
//   implied           = max(1, round(tvl_usd * category_multiple * chain_premium * growth_factor * maturity_factor * scale_factor))
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  // Category benchmark: will be computed from snapshot; this is the global fallback
  global_multiple: number;
  // Chain premium weights
  blue_chip_weight: number;
  blue_chip_cap: number;
  extra_chain_weight: number;
  // Growth weight and clamps
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  // Maturity
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  // Scale (TVL diminishing returns)
  scale_anchor_tvl: number;   // TVL at which scale_factor = 1.0
  scale_decay: number;        // decay per log10 above anchor
}

export const MODEL: ModelConstants = {
  global_multiple: 0.2227,
  blue_chip_weight: 0.05,
  blue_chip_cap: 3,
  extra_chain_weight: 0.02,
  growth_weight: 0.3,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  scale_anchor_tvl: 1e8,
  scale_decay: 0.1,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    chain_premium: number;
    growth_factor: number;
    maturity_factor: number;
    scale_factor: number;
    category_peer_count: number;
    blue_chip_chains: number;
    total_chains: number;
    growth_pct: number;
    age_days: number | null;
    tvl_usd: number;
  };
  farm_steps: string[];
  rationale: string;
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    chain_premium: number;
    growth_factor: number;
    maturity_factor: number;
    scale_factor: number;
    category_peer_count: number;
    blue_chip_chains: number;
    total_chains: number;
    growth_pct: number;
    age_days: number | null;
    tvl_usd: number;
  };
  rationale: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// Blue-chip chains (the house model's set)
const BLUE_CHIP_CHAINS = new Set([
  'Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'BNB', 'Binance',
  'Polygon', 'Avalanche', 'Sui', 'Hyperliquid', 'Hyperliquid L1'
]);

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Compute category multiples from token-bearing protocols in the snapshot. */
function computeCategoryMultiples(protocols: SnapshotProtocol[]): Map<string, { multiple: number; peerCount: number }> {
  const byCat = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const c = p.category ?? 'Other';
      const arr = byCat.get(c) ?? [];
      arr.push(p.mcap_usd / p.tvl_usd);
      byCat.set(c, arr);
    }
  }
  const out = new Map<string, { multiple: number; peerCount: number }>();
  for (const [cat, multiples] of byCat) {
    if (multiples.length >= 3) {
      multiples.sort((a, b) => a - b);
      out.set(cat, { multiple: multiples[Math.floor(multiples.length / 2)], peerCount: multiples.length });
    }
  }
  return out;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  catMultiples: Map<string, { multiple: number; peerCount: number }>
): {
  implied: number;
  category_multiple: number;
  chain_premium: number;
  growth_factor: number;
  maturity_factor: number;
  scale_factor: number;
  category_peer_count: number;
  blue_chip_chains: number;
  total_chains: number;
  growth_pct: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const cat = protocol.category ?? 'Other';
  const catInfo = catMultiples.get(cat);
  const category_multiple = catInfo ? catInfo.multiple : model.global_multiple;
  const category_peer_count = catInfo ? catInfo.peerCount : 0;

  const rawGrowth = finite(protocol.change_7d, 0);
  const growth_pct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growth_factor = 1 + (growth_pct / 100) * model.growth_weight;

  const ageForModel = age ?? model.unknown_age_days;
  const maturity_factor = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;

  const blue_chip_chains = protocol.chains.filter(c => BLUE_CHIP_CHAINS.has(c)).length;
  const total_chains = protocol.chains.length;
  const chain_premium = 1 + model.blue_chip_weight * Math.min(blue_chip_chains, model.blue_chip_cap) + model.extra_chain_weight * Math.max(total_chains - 1, 0);

  const scale_factor = 1 / (1 + model.scale_decay * Math.max(Math.log10(protocol.tvl_usd / model.scale_anchor_tvl), 0));

  const base = protocol.tvl_usd * category_multiple;
  const implied = Math.max(1, Math.round(base * chain_premium * growth_factor * maturity_factor * scale_factor));

  return { implied, category_multiple, chain_premium, growth_factor, maturity_factor, scale_factor, category_peer_count, blue_chip_chains, total_chains, growth_pct, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Format a number with tabular numerals for display. */
function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Build a human-readable rationale sentence. */
function buildRationale(p: SnapshotProtocol, parts: {
  category_multiple: number;
  chain_premium: number;
  growth_factor: number;
  maturity_factor: number;
  scale_factor: number;
  category_peer_count: number;
  blue_chip_chains: number;
  total_chains: number;
  growth_pct: number;
  age: number | null;
}): string {
  const cat = p.category ?? 'Other';
  const ageStr = parts.age === null ? 'unknown age' : parts.age < 365 ? `${parts.age}d` : `${(parts.age / 365).toFixed(1)}y`;
  const growthStr = parts.growth_pct >= 0 ? `+${parts.growth_pct.toFixed(1)}%` : `${parts.growth_pct.toFixed(1)}%`;
  const blueChipStr = parts.blue_chip_chains > 0 ? `${parts.blue_chip_chains} blue-chip chain${parts.blue_chip_chains === 1 ? '' : 's'}` : 'no blue-chip chains';
  const peerStr = parts.category_peer_count >= 3 ? `(${parts.category_peer_count} token peers)` : '(global fallback)';
  return `${cat} protocol, ${ageStr}, ${growthStr} 7d, ${blueChipStr} ${peerStr}. Category multiple ${parts.category_multiple.toFixed(3)}x TVL, chain premium ${parts.chain_premium.toFixed(2)}x, growth ${parts.growth_factor.toFixed(2)}x, maturity ${parts.maturity_factor.toFixed(2)}x, scale ${parts.scale_factor.toFixed(2)}x.`;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Compute category multiples from all token-bearing protocols in snapshot
  const catMultiples = computeCategoryMultiples(snapshot.protocols);

  const scored = [...chosen.values()].map((p) => {
    const parts = impliedValue(p, snapshot.as_of, model, catMultiples);
    return { p, ...parts };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: Math.round(s.category_multiple * 1e4) / 1e4,
      chain_premium: Math.round(s.chain_premium * 1e4) / 1e4,
      growth_factor: Math.round(s.growth_factor * 1e4) / 1e4,
      maturity_factor: Math.round(s.maturity_factor * 1e4) / 1e4,
      scale_factor: Math.round(s.scale_factor * 1e4) / 1e4,
      category_peer_count: s.category_peer_count,
      blue_chip_chains: s.blue_chip_chains,
      total_chains: s.total_chains,
      growth_pct: Math.round(s.growth_pct * 100) / 100,
      age_days: s.age,
      tvl_usd: s.p.tvl_usd,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    rationale: buildRationale(s.p, s),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Capital tier from TVL: larger protocols need more capital to be noticed. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** Hold days from age: younger protocols need longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Category-specific action verb and asset. */
function categoryAction(p: SnapshotProtocol, capital: number, chain: string): { verb: string; asset: string; target: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return { verb: 'Supply', asset: `$${capital} USDC`, target: `to ${name} on ${chain}` };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('amm')) {
    return { verb: 'Provide liquidity', asset: `$${capital} to ${name}'s main pool`, target: `on ${chain}` };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return { verb: 'Bridge', asset: `$${capital} USDC`, target: `to ${chain} via ${name}` };
  }
  if (c.includes('staking') || c.includes('restak') || c.includes('liquid staking')) {
    return { verb: 'Stake', asset: `$${capital} of the chain's staking asset`, target: `through ${name}` };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return { verb: 'Deposit margin', asset: `$${capital} USDC`, target: `on ${name} and open a small hedge` };
  }
  if (c.includes('prediction')) {
    return { verb: 'Fund', asset: `$${capital}`, target: `and place one market position on ${name}` };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return { verb: 'Deposit', asset: `$${capital}`, target: `into a ${name} vault on ${chain}` };
  }
  if (c.includes('stable') || c.includes('algo-stable')) {
    return { verb: 'Mint or deposit', asset: `$${capital} of the stable asset`, target: `through ${name} on ${chain}` };
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return { verb: 'Mint', asset: `$${capital} of ${name}'s yield asset`, target: `on ${chain}` };
  }
  if (c.includes('insurance')) {
    return { verb: 'Buy cover', asset: `$${capital}`, target: `from ${name} on ${chain}` };
  }
  if (c.includes('basis trading') || c.includes('delta neutral')) {
    return { verb: 'Deploy', asset: `$${capital} in delta-neutral strategy`, target: `via ${name} on ${chain}` };
  }
  if (c.includes('risk curator') || c.includes('risk management')) {
    return { verb: 'Allocate', asset: `$${capital} to ${name}'s risk vault`, target: `on ${chain}` };
  }
  if (c.includes('payment')) {
    return { verb: 'Send', asset: `$${capital} USDC`, target: `through ${name} on ${chain}` };
  }
  if (c.includes('chain') || c.includes('l2') || c.includes('l1')) {
    return { verb: 'Bridge', asset: `$${capital} USDC`, target: `to ${name} (${chain}) and use a core app` };
  }
  return { verb: 'Deposit', asset: `$${capital} USDC`, target: `into ${name} on ${chain}` };
}

/**
 * A protocol's farm plan: 6 steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const primaryChain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = categoryAction(p, capital, primaryChain);
  const baseAction = `${action.verb} ${action.asset} ${action.target} and keep the position open.`;

  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: baseAction,
      cost: `$${capital} of capital and about $${capital >= 250 ? 12 : capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week: ${categoryWeeklyAction(p)}`,
      cost: 'about $2–5 of gas per week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps;
}

/** Category-specific weekly qualifying action. */
function categoryWeeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a deposit, borrow, or repay';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('amm')) return 'a swap, add/remove liquidity, or harvest';
  if (c.includes('bridge') || c.includes('cross chain')) return 'a bridge transaction or use bridged funds in an app';
  if (c.includes('staking') || c.includes('restak') || c.includes('liquid staking')) return 'a stake, re-stake, or claim rewards';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'a trade, adjust margin, or settle a position';
  if (c.includes('prediction')) return 'a new position or adjust an existing one';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return 'a deposit, withdraw, or rebalance';
  if (c.includes('stable') || c.includes('algo-stable')) return 'a mint, redeem, or swap';
  if (c.includes('rwa') || c.includes('real world')) return 'a mint, redeem, or hold the yield asset';
  if (c.includes('insurance')) return 'buy or renew cover, or file a claim if eligible';
  if (c.includes('basis trading') || c.includes('delta neutral')) return 'rebalance the delta-neutral position';
  if (c.includes('risk curator') || c.includes('risk management')) return 'adjust allocation or rebalance the vault';
  if (c.includes('payment')) return 'a send, receive, or swap transaction';
  if (c.includes('chain') || c.includes('l2') || c.includes('l1')) return 'a bridge, swap, or app interaction on the chain';
  return 'a deposit, swap, or vote';
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    model: {
      category_multiple: row.model.category_multiple,
      chain_premium: row.model.chain_premium,
      growth_factor: row.model.growth_factor,
      maturity_factor: row.model.maturity_factor,
      scale_factor: row.model.scale_factor,
      category_peer_count: row.model.category_peer_count,
      blue_chip_chains: row.model.blue_chip_chains,
      total_chains: row.model.total_chains,
      growth_pct: row.model.growth_pct,
      age_days: row.model.age_days,
      tvl_usd: row.model.tvl_usd,
    },
    rationale: row.rationale,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}