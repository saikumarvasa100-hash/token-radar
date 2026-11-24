// Token Radar — Dark radar dashboard.
// Reads window.RADAR (written beside dashboard/ by main.ts) and renders:
// - Ranked board with sortable columns, text search, category/chain/TVL/token filters
// - Detail drawer per protocol with model breakdown, rationale, farm plan
// - Filter chips row showing active filters
// - Aggregate header stats
// No network: every byte shown is in data.js. Inline SVG only.

(function () {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;

  const app = document.getElementById('board');
  const state = {
    q: '',
    category: 'all',
    chain: 'all',
    tvlBand: 'all',
    tokenStatus: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };

  // Formatters
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function fmtTvlBand(tvl) {
    if (tvl >= 1e9) return '≥$1B';
    if (tvl >= 1e8) return '$100M–$1B';
    if (tvl >= 5e7) return '$50M–$100M';
    if (tvl >= 1e7) return '$10M–$50M';
    return '<$10M';
  }

  // URL hash state sync
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvlBand = params.get('tvl');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvlBand !== 'all') params.set('tvl', state.tvlBand);
    if (state.selected) params.set('p', state.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Element factory
  function el(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Inline SVG bar
  function barSvg(pct) {
    const w = Math.max(2, Math.min(100, Math.round(pct)));
    return '<svg width="100" height="5" viewBox="0 0 100 5" aria-hidden="true"><rect x="0" y="0" width="100" height="5" fill="var(--border)" rx="3"/><rect x="0" y="0" width="' + w + '" height="5" fill="url(#grad)" rx="3"/></svg>';
  }

  // Farm plan generation (same logic as model.ts)
  const BLUE_CHIP_CHAINS = new Set(['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'BNB', 'Binance', 'Polygon', 'Avalanche', 'Sui', 'Hyperliquid', 'Hyperliquid L1']);

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 1e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 90) return 90;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function categoryAction(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    const name = p.name;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return { verb: 'Supply', asset: '$' + capital + ' USDC', target: 'to ' + name + ' on ' + chain };
    if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('amm')) return { verb: 'Provide liquidity', asset: '$' + capital, target: 'to ' + name + "'s main pool on " + chain };
    if (c.includes('bridge') || c.includes('cross chain')) return { verb: 'Bridge', asset: '$' + capital + ' USDC', target: 'to ' + chain + ' via ' + name };
    if (c.includes('staking') || c.includes('restak') || c.includes('liquid staking')) return { verb: 'Stake', asset: '$' + capital + ' of the chain\'s staking asset', target: 'through ' + name };
    if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return { verb: 'Deposit margin', asset: '$' + capital + ' USDC', target: 'on ' + name + ' and open a small hedge' };
    if (c.includes('prediction')) return { verb: 'Fund', asset: '$' + capital, target: 'and place one market position on ' + name };
    if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return { verb: 'Deposit', asset: '$' + capital, target: 'into a ' + name + ' vault on ' + chain };
    if (c.includes('stable') || c.includes('algo-stable')) return { verb: 'Mint or deposit', asset: '$' + capital + ' of the stable asset', target: 'through ' + name + ' on ' + chain };
    if (c.includes('rwa') || c.includes('real world')) return { verb: 'Mint', asset: '$' + capital + ' of ' + name + '\'s yield asset', target: 'on ' + chain };
    if (c.includes('insurance')) return { verb: 'Buy cover', asset: '$' + capital, target: 'from ' + name + ' on ' + chain };
    if (c.includes('basis trading') || c.includes('delta neutral')) return { verb: 'Deploy', asset: '$' + capital + ' in delta-neutral strategy', target: 'via ' + name + ' on ' + chain };
    if (c.includes('risk curator') || c.includes('risk management')) return { verb: 'Allocate', asset: '$' + capital + ' to ' + name + '\'s risk vault', target: 'on ' + chain };
    if (c.includes('payment')) return { verb: 'Send', asset: '$' + capital + ' USDC', target: 'through ' + name + ' on ' + chain };
    if (c.includes('chain') || c.includes('l2') || c.includes('l1')) return { verb: 'Bridge', asset: '$' + capital + ' USDC', target: 'to ' + name + ' (' + chain + ') and use a core app' };
    return { verb: 'Deposit', asset: '$' + capital + ' USDC', target: 'into ' + name + ' on ' + chain };
  }
  function categoryWeeklyAction(p) {
    const c = (p.category || '').toLowerCase();
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
  function stepText(step) {
    let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  // Render each farm-step with Cost and Time on their own lines
  function farmStepLines(step) {
    var s = stepText(step);
    s = s.replace(/\. Cost:/g, '.\nCost:');
    s = s.replace(/\. Time:/g, '.\nTime:');
    return s;
  }
  function farmSteps(p) {
    const primaryChain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const action = categoryAction(p, capital, primaryChain);
    const baseAction = action.verb + ' ' + action.asset + ' ' + action.target + ' and keep the position open.';
    const gasEstimate = capital >= 250 ? 12 : capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: baseAction, cost: '$' + capital + ' of capital and about $' + gasEstimate + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week: ' + categoryWeeklyAction(p), cost: 'about $2–5 of gas per week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // Filtering
  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    const cats = state.category;
    const chains = state.chain;
    const tvlBand = state.tvlBand;
    return DATA.rows.filter(function (r) {
      if (cats !== 'all' && r.category !== cats) return false;
      if (chains !== 'all' && !r.chains.includes(chains)) return false;
      if (tvlBand !== 'all') {
        const band = fmtTvlBand(r.tvl_usd);
        if (band !== tvlBand) return false;
      }
      if (!q) return true;
      const hay = [r.name, r.slug, r.category || '', r.chains.join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  // Sorting
  function sortedRows(list) {
    const key = state.sort;
    return list.slice().sort(function (a, b) {
      let av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // Active filter chips
  function renderChips() {
    const chips = [];
    if (state.q) chips.push({ label: 'Search', value: state.q, key: 'q' });
    if (state.category !== 'all') chips.push({ label: 'Category', value: state.category, key: 'category' });
    if (state.chain !== 'all') chips.push({ label: 'Chain', value: state.chain, key: 'chain' });
    if (state.tvlBand !== 'all') chips.push({ label: 'TVL', value: state.tvlBand, key: 'tvlBand' });
    if (chips.length === 0) return null;
    return el('div', { class: 'chip-row' }, chips.map(function (c) {
      return el('span', { class: 'chip' },
        el('span', null, c.label + ': '),
        el('strong', { text: c.value }),
        el('button', { 'aria-label': 'Remove ' + c.label + ' filter', onclick: function () { state[c.key] = c.key === 'q' ? '' : 'all'; writeHash(); render(); } }, '×')
      );
    }));
  }

  // Header
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // Hero / Facts
  function lede() {
    const totalTVL = DATA.rows.reduce((sum, r) => sum + r.tvl_usd, 0);
    const medianImplied = (function () {
      const vals = DATA.rows.map(r => r.implied_value_usd).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    })();
    const bestOpp = DATA.rows[0];

    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Watchlist covered' }), el('span', { class: 'fact-value', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Pre-token rows scored' }), el('span', { class: 'fact-value', text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Early rows below floor' }), el('span', { class: 'fact-value', text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Live-token set aside' }), el('span', { class: 'fact-value', text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Total TVL (board)' }), el('span', { class: 'fact-value', text: fmtUsd(totalTVL) })),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Median implied value' }), el('span', { class: 'fact-value', text: fmtUsd(medianImplied) })),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Best opportunity' }), el('span', { class: 'fact-value', text: bestOpp ? bestOpp.name : '—' }, bestOpp ? el('small', { text: ' ' + fmtUsd(bestOpp.implied_value_usd) }) : null)),
        el('div', { class: 'fact' }, el('span', { class: 'fact-label', text: 'Model version' }), el('span', { class: 'fact-value', text: DATA.model_version }))
      )
    );
  }

  // Controls
  function controls() {
    const categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    const allChains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains; }))).sort();
    const tvlBands = ['≥$1B', '$100M–$1B', '$50M–$100M', '$10M–$50M', '<$10M'];

    const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });

    const catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });

    const chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      allChains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });

    const tvlSelect = el('select', { id: 'tvl', 'aria-label': 'Filter by TVL band' },
      el('option', { value: 'all', text: 'All TVL bands' }),
      tvlBands.map(function (b) { return el('option', { value: b, text: b, selected: b === state.tvlBand ? 'selected' : null }); })
    );
    tvlSelect.addEventListener('change', function () { state.tvlBand = tvlSelect.value; writeHash(); render(); });

    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'TVL Band' }), tvlSelect),
      el('span', { class: 'count', text: filteredRows().length + ' rows shown' })
    );
  }

  // Sort header
  function sortHeader(key, label) {
    const active = state.sort === key;
    return el('th', { scope: 'col', 'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        el('span', { class: 'sort-icon', 'aria-hidden': 'true', text: active ? (state.dir < 0 ? ' ▼' : ' ▲') : ' ⇅' })
      )
    );
  }

  // Board table
  function boardTable() {
    const list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or adjust the filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear all filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvlBand = 'all'; writeHash(); render(); } })
      ));
    }
    const maxImplied = list[0].implied_value_usd || 1;
    const tbody = el('tbody');
    list.forEach(function (r) {
      const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const barPct = (r.implied_value_usd / maxImplied) * 100;
      const tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: state.selected === r.slug ? 'selected' : '',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('strong', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('span', { class: 'bar', html: barSvg(barPct), 'aria-hidden': 'true' }),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Click a row for model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d %'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied Value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // Live token table (secondary tab - keeping it simple)
  function liveTable() {
    const tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('strong', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d %' }), el('th', { scope: 'col', text: 'Market Cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // Model panel
  function modelPanel() {
    const m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', html:
        'implied = round( tvl_usd<br>' +
        '  × category_multiple &nbsp; <span class="accent">(median mcap/tvl of token peers in category, or global fallback)</span><br>' +
        '  × chain_premium &nbsp; <span class="accent">(1 + ' + m.blue_chip_weight + '×min(blue_chip_chains,' + m.blue_chip_cap + ') + ' + m.extra_chain_weight + '×max(total_chains−1,0))</span><br>' +
        '  × growth_factor &nbsp; <span class="accent">(1 + clamp(change_7d,' + m.growth_floor + ',' + m.growth_cap + ')/100 × ' + m.growth_weight + ')</span><br>' +
        '  × maturity_factor &nbsp; <span class="accent">(' + m.maturity_floor + ' + min(age_days,' + m.maturity_days + ')/' + m.maturity_days + ' × ' + m.maturity_range + ')</span><br>' +
        '  × scale_factor &nbsp; <span class="accent">(1 / (1 + ' + m.scale_decay + '×max(log10(tvl/' + m.scale_anchor_tvl.toExponential(0) + '),0)))</span><br>' +
        ')' }),
      el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is days since first listing (unknown → ' + m.unknown_age_days + 'd). Blue-chip chains: Ethereum, Solana, Base, Arbitrum, Optimism, BNB, Polygon, Avalanche, Sui, Hyperliquid. Early radar: all pre-token protocols below the watchlist floor, by TVL. Live-token protocols are shown with their market caps.' })
    );
  }

  // Detail drawer
  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    const row = DATA.rows.find(function (r) { return r.slug === slug; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.innerHTML = '';

    const steps = farmSteps(row);
    const m = row.model;

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    // Implied value breakdown
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('strong', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (m.category_peer_count ? m.category_peer_count + ' token peers' : 'global fallback') + ')' }), el('strong', { class: 'num', text: m.category_multiple.toFixed(4) + '×' })),
        el('div', null, el('span', { text: 'Chain premium (' + m.blue_chip_chains + ' blue-chip, ' + m.total_chains + ' total)' }), el('strong', { class: 'num', text: m.chain_premium.toFixed(2) + '×' })),
        el('div', null, el('span', { text: 'Growth factor (' + (m.growth_pct >= 0 ? '+' : '') + m.growth_pct.toFixed(2) + '% 7d)' }), el('strong', { class: 'num ' + (m.growth_pct >= 0 ? 'pos' : 'neg'), text: m.growth_factor.toFixed(2) + '×' })),
        el('div', null, el('span', { text: 'Maturity factor (' + (m.age_days === null ? 'unknown' : m.age_days + 'd') + ')' }), el('strong', { class: 'num', text: m.maturity_factor.toFixed(2) + '×' })),
        el('div', null, el('span', { text: 'Scale factor (TVL ' + fmtUsd(m.tvl_usd) + ')' }), el('strong', { class: 'num', text: m.scale_factor.toFixed(2) + '×' })),
        el('div', null, el('span', { text: 'Implied value' }), el('strong', { class: 'num', style: 'color: var(--value)', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Rationale: ' + row.rationale })
    ));

    // Farm plan
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var lines = farmStepLines(s);
        var at = lines.indexOf('\n');
        var action = at >= 0 ? lines.slice(0, at) : lines;
        var rest = at >= 0 ? lines.slice(at + 1) : '';
        return el('li', null,
          el('strong', { text: action }),
          el('span', { class: 'cost', text: rest })
        );
      }))
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // Main render
  function render() {
    app.innerHTML = '';
    const shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    const chips = renderChips();
    if (chips) shell.appendChild(chips);
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  window.addEventListener('popstate', function () { readHash(); render(); });
})();