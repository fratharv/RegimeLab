/* ============================================================
   RegimeLab — core simulator, backtester, charts, window.RL API
   ============================================================ */

(function () {
  "use strict";

  /* ---------- constants ---------- */

  const REGIMES = ["trending", "mean_reverting", "high_vol", "shock"];
  const REGIME_LABEL = {
    trending: "Trending",
    mean_reverting: "Mean Reverting",
    high_vol: "High Volatility",
    shock: "Shock",
  };
  const REGIME_COLOR = {
    trending: "#3ecf8e",
    mean_reverting: "#4f8cff",
    high_vol: "#d9a441",
    shock: "#e5484d",
  };

  const PARAM_SPEC = {
    trend: { min: 0, max: 1 },
    meanrev: { min: 0, max: 1 },
    vol: { min: 0.05, max: 1 },
    shockp: { min: 0, max: 0.2 },
    shockm: { min: 0.01, max: 0.2 },
    persist: { min: 0.05, max: 1 },
    trans: { min: 0, max: 1 },
    len: { min: 100, max: 5000 },
    cap: { min: 10000, max: 1000000 },
    ma: { min: 5, max: 100 },
    sl: { min: 0.5, max: 15 },
    tp: { min: 0.5, max: 30 },
    ps: { min: 5, max: 100 },
  };

  const DEFAULT_PARAMS = {
    trend: 0.3,
    meanrev: 0.2,
    vol: 0.2,
    shockp: 0.01,
    shockm: 0.05,
    persist: 0.85,
    trans: 0.05,
    len: 1000,
    cap: 100000,
    ma: 20,
    sl: 3,
    tp: 6,
    ps: 25,
  };

  /* ---------- state ---------- */

  let params = Object.assign({}, DEFAULT_PARAMS);
  let seed = Math.floor(Math.random() * 2 ** 31);
  let dataSource = "synthetic"; // "synthetic" | "real"
  let realPrices = null;

  let lastResult = null; // { prices, regimes, equity, dates, metrics, byRegime, trades }

  let priceChart = null;
  let equityChart = null;

  /* ---------- helpers ---------- */

  function clamp(v, min, max) {
    if (Number.isNaN(v) || v === null || v === undefined) return min;
    return Math.min(max, Math.max(min, v));
  }

  function clampParams(p) {
    const out = {};
    for (const key of Object.keys(PARAM_SPEC)) {
      const spec = PARAM_SPEC[key];
      const v = p[key] !== undefined ? Number(p[key]) : DEFAULT_PARAMS[key];
      out[key] = clamp(v, spec.min, spec.max);
    }
    return out;
  }

  function safeNum(v, fallback) {
    if (v === null || v === undefined) return fallback;
    if (typeof v !== "number" || Number.isNaN(v) || !Number.isFinite(v)) return fallback;
    return v;
  }

  // mulberry32 seeded RNG
  function makeRng(s) {
    let a = s >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randNormal(rng) {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function fmtMoney(v) {
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  function fmtPct(v, digits) {
    digits = digits === undefined ? 2 : digits;
    if (!Number.isFinite(v)) return "—";
    return (v * 100).toFixed(digits) + "%";
  }
  function fmtNum(v, digits) {
    digits = digits === undefined ? 2 : digits;
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(digits);
  }

  /* ---------- market generation ---------- */

  function pickWeighted(rng, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  // Base regimes (excluding "shock", which is an overlay event)
  const BASE_REGIMES = ["trending", "mean_reverting", "high_vol"];

  function generateMarket(p, rngSeed) {
    const rng = makeRng(rngSeed);
    const n = Math.round(p.len);

    const baseWeights = [
      Math.max(0.02, p.trend),
      Math.max(0.02, p.meanrev),
      Math.max(0.02, p.vol * 0.6),
    ];

    const prices = new Array(n);
    const regimes = new Array(n);
    const logPrices = new Array(n);

    let price = 100;
    prices[0] = price;
    logPrices[0] = Math.log(price);

    let curBaseIdx = pickWeighted(rng, baseWeights);
    let trendSign = rng() < 0.5 ? -1 : 1;
    let rollingMeanLog = logPrices[0];

    // effective persistence: higher trans => more frequent regime switching
    const stayProb = clamp(p.persist * (1 - 0.6 * p.trans), 0.02, 0.99);

    regimes[0] = BASE_REGIMES[curBaseIdx];

    for (let i = 1; i < n; i++) {
      // Markov transition of base regime
      if (rng() > stayProb) {
        const newIdx = pickWeighted(rng, baseWeights);
        if (newIdx !== curBaseIdx) {
          curBaseIdx = newIdx;
          if (curBaseIdx === 0) trendSign = rng() < 0.5 ? -1 : 1;
        }
      }

      const baseRegime = BASE_REGIMES[curBaseIdx];
      let ret = 0;

      if (baseRegime === "trending") {
        ret = trendSign * p.trend * 0.0025 + randNormal(rng) * (0.004 + p.vol * 0.01);
      } else if (baseRegime === "mean_reverting") {
        const gap = logPrices[i - 1] - rollingMeanLog;
        ret = -p.meanrev * 0.6 * gap + randNormal(rng) * (0.003 + p.vol * 0.008);
      } else {
        // high_vol
        ret = randNormal(rng) * (0.006 + p.vol * 0.03);
      }

      // independent shock overlay
      let regimeLabel = baseRegime;
      if (rng() < p.shockp) {
        const sign = rng() < 0.5 ? -1 : 1;
        ret += sign * p.shockm;
        regimeLabel = "shock";
      }

      logPrices[i] = logPrices[i - 1] + ret;
      price = Math.exp(logPrices[i]);
      if (!Number.isFinite(price) || price <= 0) {
        price = prices[i - 1];
        logPrices[i] = Math.log(price);
      }
      prices[i] = price;
      regimes[i] = regimeLabel;

      // rolling mean (simple exponential) for mean-reversion anchor
      const alpha = 0.02;
      rollingMeanLog = rollingMeanLog * (1 - alpha) + logPrices[i] * alpha;
    }

    return { prices, regimes };
  }

  /* ---------- moving average ---------- */

  function computeMA(prices, period) {
    const n = prices.length;
    const ma = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += prices[i];
      if (i >= period) sum -= prices[i - period];
      if (i >= period - 1) ma[i] = sum / period;
    }
    return ma;
  }

  /* ---------- backtest ---------- */

  function backtest(prices, regimes, p) {
    const n = prices.length;
    const period = Math.round(p.ma);
    const ma = computeMA(prices, period);

    let cash = p.cap;
    let shares = 0;
    let entryPrice = null;
    let entryIdx = null;
    let entryRegime = null;

    const equity = new Array(n).fill(p.cap);
    const trades = []; // { entryIdx, exitIdx, entryRegime, pnl, ret }

    const startIdx = Math.max(period, 1);

    for (let i = startIdx; i < n; i++) {
      const price = prices[i];
      const maNow = ma[i];
      const maPrev = ma[i - 1];
      const priceHasMA = maNow !== null && maPrev !== null;

      if (shares === 0) {
        if (priceHasMA && prices[i - 1] <= maPrev && price > maNow) {
          const allocation = cash * (p.ps / 100);
          shares = allocation / price;
          cash -= shares * price;
          entryPrice = price;
          entryIdx = i;
          entryRegime = regimes[i];
        }
      } else {
        const changePct = (price - entryPrice) / entryPrice;
        const hitStop = changePct <= -p.sl / 100;
        const hitTarget = changePct >= p.tp / 100;
        const crossDown = priceHasMA && prices[i - 1] >= maPrev && price < maNow;

        if (hitStop || hitTarget || crossDown) {
          const proceeds = shares * price;
          const costBasis = shares * entryPrice;
          const pnl = proceeds - costBasis;
          cash += proceeds;
          trades.push({
            entryIdx,
            exitIdx: i,
            entryRegime,
            pnl,
            ret: pnl / costBasis,
          });
          shares = 0;
          entryPrice = null;
          entryIdx = null;
          entryRegime = null;
        }
      }

      equity[i] = cash + shares * price;
    }

    // close any open position at the last bar (mark-to-market, not a realized trade)
    if (shares > 0) {
      equity[n - 1] = cash + shares * prices[n - 1];
    }

    return { equity, trades, ma };
  }

  /* ---------- metrics ---------- */

  function dailyReturns(equity, fromIdx) {
    const rets = [];
    for (let i = Math.max(1, fromIdx); i < equity.length; i++) {
      const prev = equity[i - 1];
      if (prev > 0) rets.push(equity[i] / prev - 1);
    }
    return rets;
  }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function stdev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const v = mean(arr.map((x) => (x - m) * (x - m)));
    return Math.sqrt(v);
  }

  function maxDrawdown(equity) {
    let peak = equity[0];
    let maxDd = 0;
    for (let i = 0; i < equity.length; i++) {
      if (equity[i] > peak) peak = equity[i];
      if (peak > 0) {
        const dd = (peak - equity[i]) / peak;
        if (dd > maxDd) maxDd = dd;
      }
    }
    return maxDd;
  }

  function computeMetrics(equity, trades, startCap, startIdx) {
    const finalEquity = equity[equity.length - 1];
    const totalReturn = startCap > 0 ? (finalEquity - startCap) / startCap : 0;
    const rets = dailyReturns(equity, startIdx);
    const sd = stdev(rets);
    const sharpe = sd > 0 ? (mean(rets) / sd) * Math.sqrt(252) : 0;
    const dd = maxDrawdown(equity.slice(startIdx));

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    const winRate = trades.length ? wins.length / trades.length : 0;
    const avgTrade = trades.length ? mean(trades.map((t) => t.pnl)) : 0;
    const grossGain = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossGain / grossLoss : (grossGain > 0 ? null : 0);

    return {
      totalReturn: safeNum(totalReturn, 0),
      sharpe: safeNum(sharpe, 0),
      maxDrawdown: safeNum(dd, 0),
      winRate: safeNum(winRate, 0),
      numTrades: trades.length,
      finalEquity: safeNum(finalEquity, startCap),
      avgTrade: safeNum(avgTrade, 0),
      profitFactor: profitFactor === null ? null : safeNum(profitFactor, 0),
    };
  }

  function computeByRegime(equity, regimes, trades, startIdx) {
    const out = {};
    for (const reg of REGIMES) {
      const idxs = [];
      for (let i = startIdx; i < regimes.length; i++) {
        if (regimes[i] === reg) idxs.push(i);
      }
      if (idxs.length < 2) {
        out[reg] = {
          bars: idxs.length,
          totalReturn: 0,
          sharpe: 0,
          maxDrawdown: 0,
          trades: trades.filter((t) => t.entryRegime === reg).length,
        };
        continue;
      }
      // build a sub-equity curve from the bars belonging to this regime (compounded, ignoring gaps)
      const subRets = [];
      for (let k = 1; k < idxs.length; k++) {
        const i = idxs[k];
        const prevI = i - 1;
        if (prevI >= 0 && equity[prevI] > 0) {
          subRets.push(equity[i] / equity[prevI] - 1);
        }
      }
      let curve = [1];
      for (const r of subRets) curve.push(curve[curve.length - 1] * (1 + r));
      const totalReturn = curve[curve.length - 1] - 1;
      const sd = stdev(subRets);
      const sharpe = sd > 0 ? (mean(subRets) / sd) * Math.sqrt(252) : 0;
      const dd = maxDrawdown(curve);

      out[reg] = {
        bars: idxs.length,
        totalReturn: safeNum(totalReturn, 0),
        sharpe: safeNum(sharpe, 0),
        maxDrawdown: safeNum(dd, 0),
        trades: trades.filter((t) => t.entryRegime === reg).length,
      };
    }
    return out;
  }

  /* ---------- run pipeline ---------- */

  function runSimulation() {
    let prices, regimes;

    if (dataSource === "real" && realPrices && realPrices.length >= 100) {
      prices = realPrices;
      regimes = detectRegimes(prices);
    } else {
      const gen = generateMarket(params, seed);
      prices = gen.prices;
      regimes = gen.regimes;
    }

    const period = Math.round(params.ma);
    const startIdx = Math.max(period, 1);
    const bt = backtest(prices, regimes, params);
    const metrics = computeMetrics(bt.equity, bt.trades, params.cap, startIdx);
    const byRegime = computeByRegime(bt.equity, regimes, bt.trades, startIdx);

    lastResult = {
      prices,
      regimes,
      equity: bt.equity,
      ma: bt.ma,
      trades: bt.trades,
      metrics,
      byRegime,
      startIdx,
    };

    renderAll();
  }

  // very simple automatic regime detection for uploaded real data,
  // based on local trend, volatility and mean-reversion strength
  function detectRegimes(prices) {
    const n = prices.length;
    const regimes = new Array(n).fill("trending");
    const window = Math.max(10, Math.min(30, Math.floor(n / 20)));
    const logP = prices.map((p) => Math.log(p));

    // rolling volatility (stdev of log returns) for shock detection
    const rets = [0];
    for (let i = 1; i < n; i++) rets.push(logP[i] - logP[i - 1]);
    const globalVol = stdev(rets.slice(1)) || 0.0001;

    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - window);
      const seg = logP.slice(lo, i + 1);
      if (seg.length < 5) {
        regimes[i] = "trending";
        continue;
      }
      const segRets = [];
      for (let k = 1; k < seg.length; k++) segRets.push(seg[k] - seg[k - 1]);
      const localVol = stdev(segRets);
      const netMove = seg[seg.length - 1] - seg[0];
      const sumAbsMove = segRets.reduce((a, b) => a + Math.abs(b), 0) || 1e-9;
      const directionality = Math.abs(netMove) / sumAbsMove; // ~1 trending, ~0 choppy

      if (Math.abs(rets[i]) > globalVol * 4) {
        regimes[i] = "shock";
      } else if (localVol > globalVol * 1.8) {
        regimes[i] = "high_vol";
      } else if (directionality > 0.35) {
        regimes[i] = "trending";
      } else {
        regimes[i] = "mean_reverting";
      }
    }
    return regimes;
  }

  /* ---------- CSV parsing ---------- */

  function detectDelimiter(line) {
    const counts = { ",": (line.match(/,/g) || []).length, ";": (line.match(/;/g) || []).length, "\t": (line.match(/\t/g) || []).length };
    let best = ",", bestCount = -1;
    for (const d of Object.keys(counts)) {
      if (counts[d] > bestCount) { best = d; bestCount = counts[d]; }
    }
    return best;
  }

  function cleanNumeric(str) {
    if (str === null || str === undefined) return NaN;
    const cleaned = String(str).replace(/[$₹,]/g, "").trim();
    return parseFloat(cleaned);
  }

  const PRICE_COL_NAMES = ["close", "adj close", "close/last", "price"];

  function parseCSV(text) {
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV appears to be empty.");

    const delim = detectDelimiter(lines[0]);
    const header = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

    let priceColIdx = -1;
    for (const name of PRICE_COL_NAMES) {
      const idx = header.indexOf(name);
      if (idx !== -1) { priceColIdx = idx; break; }
    }
    if (priceColIdx === -1) {
      throw new Error('No recognizable price column found. Expected one of: Close, Adj Close, Close/Last, Price.');
    }
    const dateColIdx = header.indexOf("date");

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delim);
      if (cols.length <= priceColIdx) continue;
      const val = cleanNumeric(cols[priceColIdx]);
      if (!Number.isFinite(val) || val <= 0) continue;
      let dateVal = null;
      if (dateColIdx !== -1 && cols[dateColIdx]) {
        const d = new Date(cols[dateColIdx].trim().replace(/^"|"$/g, ""));
        if (!Number.isNaN(d.getTime())) dateVal = d.getTime();
      }
      rows.push({ price: val, date: dateVal });
    }

    if (rows.length < 100) {
      throw new Error(`Found only ${rows.length} valid prices. At least 100 are required.`);
    }

    // reverse if newest-first
    if (dateColIdx !== -1) {
      const withDates = rows.filter((r) => r.date !== null);
      if (withDates.length >= 2 && withDates[0].date > withDates[withDates.length - 1].date) {
        rows.reverse();
      }
    }

    let prices = rows.map((r) => r.price);
    if (prices.length > 5000) prices = prices.slice(prices.length - 5000);

    return prices;
  }

  /* ---------- rendering ---------- */

  function renderSliders() {
    for (const key of Object.keys(PARAM_SPEC)) {
      const input = document.getElementById(key);
      const label = document.getElementById(key + "-val");
      if (!input || !label) continue;
      input.value = params[key];
      label.textContent = formatSliderVal(key, params[key]);
    }
  }

  function formatSliderVal(key, v) {
    if (key === "len" || key === "ma" || key === "ps") return String(Math.round(v));
    if (key === "cap") return Math.round(v).toLocaleString();
    if (key === "shockp" || key === "shockm") return v.toFixed(3);
    if (key === "sl" || key === "tp") return v.toFixed(1);
    return v.toFixed(2);
  }

  function renderRegimeLegend() {
    const el = document.getElementById("regimeLegend");
    if (!el) return;
    el.innerHTML = REGIMES.map(
      (r) =>
        `<span><span class="legend-dot" style="background:${REGIME_COLOR[r]}"></span>${REGIME_LABEL[r]}</span>`
    ).join("");
  }

  function renderRegimeStrip() {
    const el = document.getElementById("regimeStrip");
    if (!el || !lastResult) return;
    const regimes = lastResult.regimes;
    el.innerHTML = "";
    let segStart = 0;
    for (let i = 1; i <= regimes.length; i++) {
      if (i === regimes.length || regimes[i] !== regimes[segStart]) {
        const len = i - segStart;
        const span = document.createElement("span");
        span.style.flexBasis = (len / regimes.length) * 100 + "%";
        span.style.background = REGIME_COLOR[regimes[segStart]] || "#444";
        el.appendChild(span);
        segStart = i;
      }
    }
  }

  function downsample(arr, maxPoints) {
    if (arr.length <= maxPoints) return arr.map((v, i) => ({ x: i, y: v }));
    const step = Math.ceil(arr.length / maxPoints);
    const out = [];
    for (let i = 0; i < arr.length; i += step) out.push({ x: i, y: arr[i] });
    if (out[out.length - 1].x !== arr.length - 1) out.push({ x: arr.length - 1, y: arr[arr.length - 1] });
    return out;
  }

  function renderCharts() {
    if (!lastResult) return;
    const ctxPrice = document.getElementById("priceChart").getContext("2d");
    const ctxEquity = document.getElementById("equityChart").getContext("2d");

    const pricePoints = downsample(lastResult.prices, 2000);
    const equityPoints = downsample(lastResult.equity, 2000);

    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",
          ticks: { color: "#8b929c", maxTicksLimit: 8 },
          grid: { color: "#23272e" },
          title: { display: true, text: "Bar #", color: "#5a6069" },
        },
        y: {
          ticks: { color: "#8b929c" },
          grid: { color: "#23272e" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "#12151a", borderColor: "#23272e", borderWidth: 1 },
      },
    };

    if (priceChart) priceChart.destroy();
    priceChart = new Chart(ctxPrice, {
      type: "line",
      data: {
        datasets: [
          {
            data: pricePoints,
            borderColor: "#4f8cff",
            backgroundColor: "transparent",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0,
          },
        ],
      },
      options: baseOpts,
    });

    if (equityChart) equityChart.destroy();
    const equityColor = lastResult.metrics.totalReturn >= 0 ? "#3ecf8e" : "#e5484d";
    equityChart = new Chart(ctxEquity, {
      type: "line",
      data: {
        datasets: [
          {
            data: equityPoints,
            borderColor: equityColor,
            backgroundColor: "transparent",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0,
          },
        ],
      },
      options: baseOpts,
    });

    renderRegimeStrip();
  }

  function metricCard(label, value, cls) {
    return `<div class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value ${cls || ""}">${value}</div>
    </div>`;
  }

  function renderMetrics() {
    const el = document.getElementById("metricsGrid");
    if (!el || !lastResult) return;
    const m = lastResult.metrics;
    const retCls = m.totalReturn > 0 ? "pos" : m.totalReturn < 0 ? "neg" : "";
    el.innerHTML = [
      metricCard("Total Return", fmtPct(m.totalReturn), retCls),
      metricCard("Sharpe Ratio", fmtNum(m.sharpe)),
      metricCard("Max Drawdown", fmtPct(m.maxDrawdown), "neg"),
      metricCard("Win Rate", fmtPct(m.winRate, 1)),
      metricCard("Trades", m.numTrades),
      metricCard("Final Equity", fmtMoney(m.finalEquity)),
      metricCard("Avg Trade", fmtMoney(m.avgTrade), m.avgTrade >= 0 ? "pos" : "neg"),
      metricCard("Profit Factor", m.profitFactor === null ? "∞" : fmtNum(m.profitFactor)),
    ].join("");
  }

  function renderRegimeTable() {
    const tbody = document.querySelector("#regimeTable tbody");
    if (!tbody || !lastResult) return;
    tbody.innerHTML = REGIMES.map((r) => {
      const d = lastResult.byRegime[r];
      const retCls = d.totalReturn > 0 ? "pos" : d.totalReturn < 0 ? "neg" : "";
      return `<tr>
        <td><span class="legend-dot" style="background:${REGIME_COLOR[r]};display:inline-block;margin-right:6px;"></span>${REGIME_LABEL[r]}</td>
        <td>${d.bars}</td>
        <td class="${retCls}">${fmtPct(d.totalReturn)}</td>
        <td>${fmtNum(d.sharpe)}</td>
        <td class="neg">${fmtPct(d.maxDrawdown)}</td>
        <td>${d.trades}</td>
      </tr>`;
    }).join("");
  }

  function renderBadge() {
    const badge = document.getElementById("dataSourceBadge");
    if (!badge) return;
    if (dataSource === "real") {
      badge.textContent = "Real data (CSV)";
      badge.classList.add("badge-real");
    } else {
      badge.textContent = "Synthetic data";
      badge.classList.remove("badge-real");
    }
  }

  function renderAll() {
    renderSliders();
    renderRegimeLegend();
    renderCharts();
    renderMetrics();
    renderRegimeTable();
    renderBadge();
  }

  /* ---------- UI wiring ---------- */

  function wireSliders() {
    for (const key of Object.keys(PARAM_SPEC)) {
      const input = document.getElementById(key);
      if (!input) continue;
      input.addEventListener("input", () => {
        params[key] = clamp(Number(input.value), PARAM_SPEC[key].min, PARAM_SPEC[key].max);
        document.getElementById(key + "-val").textContent = formatSliderVal(key, params[key]);
      });
    }
  }

  function wireGenerateButton() {
    const btn = document.getElementById("generateBtn");
    btn.addEventListener("click", () => {
      seed = Math.floor(Math.random() * 2 ** 31);
      runSimulation();
    });
  }

  function handleCsvFile(file, statusElId) {
    const statusEl = document.getElementById(statusElId);
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const prices = parseCSV(e.target.result);
        realPrices = prices;
        dataSource = "real";
        if (statusEl) statusEl.textContent = `Loaded ${prices.length} prices from "${file.name}".`;
        const clearBtn = document.getElementById("clearCsvBtn");
        if (clearBtn) clearBtn.style.display = "inline-block";
        runSimulation();
        if (window.RegimeLabAI && window.RegimeLabAI.notifyDataLoaded) {
          window.RegimeLabAI.notifyDataLoaded(prices.length, file.name);
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = "Error: " + err.message;
      }
    };
    reader.onerror = function () {
      if (statusEl) statusEl.textContent = "Could not read file.";
    };
    reader.readAsText(file);
  }

  function wireCsvUpload() {
    const inputMain = document.getElementById("csvInputMain");
    if (inputMain) {
      inputMain.addEventListener("change", () => {
        if (inputMain.files && inputMain.files[0]) {
          handleCsvFile(inputMain.files[0], "csvStatusMain");
        }
      });
    }
    const inputCopilot = document.getElementById("csvInputCopilot");
    if (inputCopilot) {
      inputCopilot.addEventListener("change", () => {
        if (inputCopilot.files && inputCopilot.files[0]) {
          handleCsvFile(inputCopilot.files[0], "csvStatusMain");
        }
      });
    }
    const clearBtn = document.getElementById("clearCsvBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        dataSource = "synthetic";
        realPrices = null;
        clearBtn.style.display = "none";
        const statusEl = document.getElementById("csvStatusMain");
        if (statusEl) statusEl.textContent = "No file loaded.";
        runSimulation();
      });
    }
  }

  /* ---------- window.RL public API ---------- */

  function snapshot() {
    if (!lastResult) {
      return {
        params: Object.assign({}, params),
        dataSource,
        periods: { len: params.len, barsUsed: 0 },
        metrics: null,
        byRegime: null,
      };
    }
    return {
      params: Object.assign({}, params),
      dataSource,
      periods: {
        len: params.len,
        barsUsed: lastResult.prices.length,
      },
      metrics: lastResult.metrics,
      byRegime: lastResult.byRegime,
    };
  }

  function apply(actions) {
    if (!actions || typeof actions !== "object") return snapshot();

    if (actions.params && typeof actions.params === "object") {
      const merged = Object.assign({}, params, actions.params);
      params = clampParams(merged);
    }

    if (actions.reseed) {
      seed = Math.floor(Math.random() * 2 ** 31);
    }

    runSimulation();
    return snapshot();
  }

  function loadPrices(prices) {
    if (!Array.isArray(prices) || prices.length < 100) {
      throw new Error("loadPrices requires an array of at least 100 numeric prices.");
    }
    const cleaned = prices.map(Number).filter((v) => Number.isFinite(v) && v > 0);
    if (cleaned.length < 100) {
      throw new Error("loadPrices requires at least 100 valid positive numeric prices.");
    }
    realPrices = cleaned.length > 5000 ? cleaned.slice(cleaned.length - 5000) : cleaned;
    dataSource = "real";
    runSimulation();
    return snapshot();
  }

  window.RL = { snapshot, apply, loadPrices };

  /* ---------- init ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    wireSliders();
    wireGenerateButton();
    wireCsvUpload();
    renderSliders();
    renderRegimeLegend();
    runSimulation();
  });
})();    else if(r==='high_vol'){ drift = (p.trend-0.5)*0.0003; volMult=2.2; }
    else if(r==='shock'){ volMult=1.6;
      if(Math.random() < p.shockp) jump = (Math.random()<0.5?-1:1) * p.shockm * (0.5+Math.random());
    }
    const noise = randNormal()*baseVol*volMult;
    let px = prices[t-1]*(1+drift+noise+jump);
    prices[t] = Math.max(1, px);
    ref = ref*0.99 + prices[t]*0.01;
  }
  return prices;
}

// ---------- Strategy backtest ----------
function movingAvg(prices, period){
  const ma = new Array(prices.length).fill(null);
  let sum=0;
  for(let i=0;i<prices.length;i++){
    sum+=prices[i];
    if(i>=period) sum-=prices[i-period];
    if(i>=period-1) ma[i]=sum/period;
  }
  return ma;
}

function backtest(prices, ma, cap0, slPct, tpPct, posPct){
  const n=prices.length;
  const equity = new Array(n).fill(cap0);
  let cash = cap0, shares=0, entryPrice=0, inPos=false;
  const trades = [];
  let cur = null;
  for(let i=1;i<n;i++){
    if(ma[i]!=null && ma[i-1]!=null){
      const crossUp = prices[i-1]<=ma[i-1] && prices[i]>ma[i];
      const crossDown = prices[i-1]>=ma[i-1] && prices[i]<ma[i];
      if(!inPos && crossUp){
        const alloc = cash*(posPct/100);
        shares = alloc/prices[i]; cash-=alloc; entryPrice=prices[i]; inPos=true;
        cur = {entryIdx:i, entryPrice:prices[i], shares};
      } else if(inPos){
        const chg = (prices[i]-entryPrice)/entryPrice;
        const hitSL = chg <= -slPct/100;
        const hitTP = chg >= tpPct/100;
        if(crossDown || hitSL || hitTP){
          cash += shares*prices[i];
          cur.exitIdx=i; cur.exitPrice=prices[i]; cur.pnlPct=chg*100; cur.pnl = shares*(prices[i]-entryPrice);
          trades.push(cur); cur=null; shares=0; inPos=false;
        }
      }
    }
    equity[i] = cash + shares*prices[i];
  }
  if(inPos){ cash += shares*prices[n-1]; equity[n-1]=cash;
    cur.exitIdx=n-1; cur.exitPrice=prices[n-1]; cur.pnlPct=((prices[n-1]-entryPrice)/entryPrice)*100;
    cur.pnl = shares*(prices[n-1]-entryPrice); trades.push(cur); }
  return {equity, trades};
}

function metricsFor(equity, trades, cap0){
  const n=equity.length;
  const finalCap = equity[n-1];
  const totalReturn = (finalCap-cap0)/cap0*100;
  let peak=equity[0], maxDD=0;
  const rets=[];
  for(let i=1;i<n;i++){
    peak=Math.max(peak,equity[i]);
    maxDD=Math.min(maxDD, (equity[i]-peak)/peak);
    rets.push((equity[i]-equity[i-1])/equity[i-1]);
  }
  const meanR = rets.reduce((a,b)=>a+b,0)/rets.length || 0;
  const sd = Math.sqrt(rets.reduce((a,b)=>a+(b-meanR)**2,0)/rets.length) || 1e-9;
  const sharpe = (meanR/sd)*Math.sqrt(252);
  const wins = trades.filter(t=>t.pnl>0), losses = trades.filter(t=>t.pnl<=0);
  const winRate = trades.length? wins.length/trades.length*100 : 0;
  const grossWin = wins.reduce((a,t)=>a+t.pnl,0), grossLoss = Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
  const profitFactor = grossLoss>0 ? grossWin/grossLoss : (grossWin>0?Infinity:0);
  const avgWin = wins.length? wins.reduce((a,t)=>a+t.pnlPct,0)/wins.length : 0;
  const avgLoss = losses.length? losses.reduce((a,t)=>a+t.pnlPct,0)/losses.length : 0;
  return {finalCap, totalReturn, maxDD:maxDD*100, sharpe, trades:trades.length, winRate, profitFactor, avgWin, avgLoss, wins:wins.length, losses:losses.length};
}

function regimePerf(segs, equity, trades){
  return segs.reduce((acc,s)=>{
    const key = s.regime;
    if(!acc[key]) acc[key]={regime:key,duration:0,startEq:null,endEq:null,minEq:Infinity,peakEq:-Infinity,trades:0};
    const o=acc[key];
    o.duration += (Math.min(s.end,equity.length)-s.start);
    for(let i=s.start;i<Math.min(s.end,equity.length);i++){
      if(o.startEq===null) o.startEq=equity[i];
      o.endEq=equity[i];
      o.peakEq=Math.max(o.peakEq,equity[i]);
      o.minEq=Math.min(o.minEq,equity[i]);
    }
    o.trades += trades.filter(t=>t.entryIdx>=s.start && t.entryIdx<s.end).length;
    return acc;
  },{});
}

// ---------- Drawing ----------
function setupCanvas(cv){
  const dpr = window.devicePixelRatio||1;
  const w = cv.clientWidth, h = cv.clientHeight || cv.height;
  cv.width = w*dpr; cv.height = h*dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr,dpr);
  return {ctx,w,h};
}

let view={a:0,b:1}, lastDraw=null;
function viewRange(n){ const s=Math.max(0,Math.floor(view.a*(n-1))); return [s, Math.min(n-1,Math.max(s+10,Math.ceil(view.b*(n-1))))]; }
function redraw(){ if(!lastDraw) return; drawMarketChart(lastDraw.prices,lastDraw.segs); drawEquityChart(lastDraw.equity,lastDraw.buyHold); }

function drawMarketChart(prices, segs){
  const cv = document.getElementById('marketChart');
  const {ctx,w,h} = setupCanvas(cv);
  ctx.clearRect(0,0,w,h);
  const padL=44,padR=10,padT=26,padB=22, n=prices.length, [s0,e0]=viewRange(n);
  const vis=prices.slice(s0,e0+1), min=Math.min(...vis), max=Math.max(...vis);
  const pad=(max-min)*0.08||1, y0=min-pad, y1=max+pad;
  const x = i => padL + ((i-s0)/(e0-s0))*(w-padL-padR);
  const y = v => padT + (1-(v-y0)/(y1-y0))*(h-padT-padB);
  const dec=(y1-y0)<10?2:(y1-y0)<50?1:0;
  ctx.strokeStyle='#1f2937'; ctx.lineWidth=1;
  for(let g=0;g<=4;g++){ const v=y0+g*(y1-y0)/4, yy=y(v);
    ctx.beginPath();ctx.moveTo(padL,yy);ctx.lineTo(w-padR,yy);ctx.stroke();
    ctx.fillStyle='#6b7688'; ctx.font='10px -apple-system,sans-serif'; ctx.textAlign='right';
    ctx.fillText(v.toFixed(dec), padL-6, yy+3);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(padL,0,w-padL-padR,h); ctx.clip();
  segs.forEach(sg=>{
    if(sg.end<s0||sg.start>e0) return;
    const x0=x(sg.start), x1=x(Math.min(sg.end,n-1)), c0=Math.max(x0,padL), c1=Math.min(x1,w-padR);
    ctx.fillStyle=REGIME_COLOR[sg.regime]+'22'; ctx.fillRect(c0,padT,c1-c0,h-padT-padB);
    ctx.strokeStyle=REGIME_COLOR[sg.regime]+'55'; ctx.beginPath(); ctx.moveTo(x0,padT); ctx.lineTo(x0,h-padB); ctx.stroke();
    ctx.fillStyle=REGIME_COLOR[sg.regime]; ctx.font='600 10px -apple-system,sans-serif'; ctx.textAlign='center';
    if(c1-c0>50) ctx.fillText(REGIME_NAME[sg.regime], (c0+c1)/2, padT-8);
  });
  ctx.strokeStyle='#3b82f6'; ctx.lineWidth=1.6; ctx.beginPath();
  const st=Math.max(s0-1,0);
  for(let i=st;i<=Math.min(e0+1,n-1);i++){ i===st?ctx.moveTo(x(i),y(prices[i])):ctx.lineTo(x(i),y(prices[i])); }
  ctx.stroke(); ctx.restore();
}

function drawEquityChart(equity, buyHold){
  const cv = document.getElementById('equityChart');
  const {ctx,w,h} = setupCanvas(cv);
  ctx.clearRect(0,0,w,h);
  const padL=48,padR=10,padT=10,padB=20, n=equity.length, [s0,e0]=viewRange(n);
  const all = equity.slice(s0,e0+1).concat(buyHold.slice(s0,e0+1));
  const min=Math.min(...all), max=Math.max(...all); const pad=(max-min)*0.08||1;
  const y0=min-pad, y1=max+pad;
  const x = i => padL + ((i-s0)/(e0-s0))*(w-padL-padR);
  const y = v => padT + (1-(v-y0)/(y1-y0))*(h-padT-padB);
  ctx.strokeStyle='#1f2937'; ctx.lineWidth=1;
  for(let g=0;g<=4;g++){ const v=y0+g*(y1-y0)/4; const yy=y(v);
    ctx.beginPath();ctx.moveTo(padL,yy);ctx.lineTo(w-padR,yy);ctx.stroke();
    ctx.fillStyle='#6b7688'; ctx.font='10px -apple-system,sans-serif'; ctx.textAlign='right';
    ctx.fillText('₹'+((y1-y0)<10000?(v/1000).toFixed(1):Math.round(v/1000))+'k', padL-6, yy+3);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(padL,0,w-padL-padR,h); ctx.clip();
  const st=Math.max(s0-1,0), en=Math.min(e0+1,n-1);
  [[buyHold,'#556070',1.2],[equity,'#22c55e',1.8]].forEach(([arr,c,lw])=>{
    ctx.strokeStyle=c; ctx.lineWidth=lw; ctx.beginPath();
    for(let i=st;i<=en;i++){ i===st?ctx.moveTo(x(i),y(arr[i])):ctx.lineTo(x(i),y(arr[i])); }
    ctx.stroke();
  });
  ctx.restore();
}

function drawDonut(wins,losses){
  const cv = document.getElementById('donutChart');
  const dpr=window.devicePixelRatio||1; const size=140;
  cv.width=size*dpr; cv.height=size*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,size,size);
  const total=wins+losses||1; const cx=70,cy=70,rO=60,rI=38;
  let start=-Math.PI/2;
  [[wins,'#22c55e'],[losses,'#ef4444']].forEach(([v,c])=>{
    const ang=(v/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,rO,start,start+ang); ctx.closePath();
    ctx.fillStyle=c; ctx.fill(); start+=ang;
  });
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath(); ctx.arc(cx,cy,rI,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#e5e9f0'; ctx.textAlign='center'; ctx.font='700 20px -apple-system,sans-serif';
  ctx.fillText(String(total), cx, cy-2);
  ctx.fillStyle='#8792a6'; ctx.font='11px -apple-system,sans-serif'; ctx.fillText('Trades', cx, cy+14);
}

// ---------- Orchestration ----------
function getParams(){
  return {
    trend:+el.trend.value, meanrev:+el.meanrev.value, vol:+el.vol.value,
    shockp:+el.shockp.value, shockm:+el.shockm.value,
    persist:+el.persist.value, trans:+el.trans.value,
    len:Math.round(+el.len.value), cap:+el.cap.value,
    ma:Math.round(+el.ma.value), sl:+el.sl.value, tp:+el.tp.value, ps:+el.ps.value
  };
}

let lastSegs=null, lastPrices=null, customData=null, lastSnap=null;
function update(reseed){
  syncLabels();
  const p = getParams();
  if(reseed){ customData=null; view={a:0,b:1}; }
  if(customData){ lastPrices=customData.prices; lastSegs=customData.segs; }
  else if(reseed || !lastSegs){
    lastSegs = buildRegimes(p.len, p.persist, p.trans);
    lastPrices = genMarket(p.len, regimeArray(p.len, lastSegs), p);
  } else if(lastPrices.length!==p.len){
    lastSegs = buildRegimes(p.len, p.persist, p.trans);
    lastPrices = genMarket(p.len, regimeArray(p.len, lastSegs), p);
  }
  const prices = lastPrices, segs = lastSegs;
  const ma = movingAvg(prices, p.ma);
  const {equity, trades} = backtest(prices, ma, p.cap, p.sl, p.tp, p.ps);
  const buyHold = prices.map(px => p.cap * (px/prices[0]));
  const m = metricsFor(equity, trades, p.cap);
  const rperf = regimePerf(segs, equity, trades);
  lastSnap = {m, rperf, n:prices.length, real:!!customData};

  lastDraw={prices,segs,equity,buyHold};
  redraw();
  drawDonut(m.wins, m.losses);

  document.getElementById('regimeLegend').innerHTML = Object.entries(REGIME_NAME)
    .map(([k,v])=>`<span><span class="dot" style="background:${REGIME_COLOR[k]}"></span>${v}</span>`).join('');

  const rc = v => v>=0?'pos':'neg';
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat"><div class="l">Total Return</div><div class="v ${rc(m.totalReturn)}">${m.totalReturn>=0?'+':''}${m.totalReturn.toFixed(1)}%</div></div>
    <div class="stat"><div class="l">Sharpe Ratio</div><div class="v">${m.sharpe.toFixed(2)}</div></div>
    <div class="stat"><div class="l">Max Drawdown</div><div class="v neg">${m.maxDD.toFixed(1)}%</div></div>
    <div class="stat"><div class="l">Total Trades</div><div class="v">${m.trades}</div></div>
    <div class="stat"><div class="l">Final Capital</div><div class="v">₹${Math.round(m.finalCap).toLocaleString()}</div></div>
    <div class="stat"><div class="l">Win Rate</div><div class="v">${m.winRate.toFixed(1)}%</div></div>
  `;

  document.getElementById('regimeTable').innerHTML = Object.values(rperf).map(o=>{
    const ret = o.startEq? (o.endEq-o.startEq)/o.startEq*100 : 0;
    const dd = o.peakEq>0 ? (o.minEq-o.peakEq)/o.peakEq*100 : 0;
    return `<tr><td><span class="regime-chip"><span class="dot" style="background:${REGIME_COLOR[o.regime]}"></span>${REGIME_NAME[o.regime]}</span></td>
      <td>${o.duration}</td><td class="${rc(ret)}">${ret>=0?'+':''}${ret.toFixed(1)}%</td>
      <td class="neg">${dd.toFixed(1)}%</td><td>${o.trades}</td></tr>`;
  }).join('');

  document.getElementById('donutLegend').innerHTML = `
    <div class="row"><span><span class="dot" style="background:#22c55e"></span>Profitable</span><b>${m.trades?((m.wins/m.trades)*100).toFixed(1):'0.0'}%</b></div>
    <div class="row"><span><span class="dot" style="background:#ef4444"></span>Losing</span><b>${m.trades?((m.losses/m.trades)*100).toFixed(1):'0.0'}%</b></div>
    <div class="row"><span>Avg Win</span><b class="pos">+${m.avgWin.toFixed(1)}%</b></div>
    <div class="row"><span>Avg Loss</span><b class="neg">${m.avgLoss.toFixed(1)}%</b></div>
    <div class="row"><span>Profit Factor</span><b>${isFinite(m.profitFactor)?m.profitFactor.toFixed(2):'∞'}</b></div>
  `;
}

// ---------- Events ----------
ids.forEach(id => el[id].addEventListener('input', ()=>update(false)));
document.getElementById('runBtn').addEventListener('click', ()=>update(true));

document.querySelectorAll('.tabs button').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById('tab-market').style.display = b.dataset.tab==='market'?'block':'none';
    document.getElementById('tab-strategy').style.display = b.dataset.tab==='strategy'?'block':'none';
  });
});

const PRESETS = {
  trending: {trend:0.85, meanrev:0.1, vol:0.35, shockp:0.02, shockm:0.06, persist:0.85, trans:0.15},
  meanrev: {trend:0.15, meanrev:0.85, vol:0.3, shockp:0.02, shockm:0.06, persist:0.75, trans:0.2},
  highvol: {trend:0.5, meanrev:0.3, vol:0.9, shockp:0.06, shockm:0.12, persist:0.4, trans:0.45},
  shock: {trend:0.4, meanrev:0.3, vol:0.6, shockp:0.15, shockm:0.18, persist:0.3, trans:0.5},
  custom: {trend:0.6, meanrev:0.3, vol:0.5, shockp:0.05, shockm:0.10, persist:0.7, trans:0.3},
};
document.querySelectorAll('.presets button').forEach(b=>{
  b.addEventListener('click', ()=>{
    const pr = PRESETS[b.dataset.preset];
    Object.entries(pr).forEach(([k,v])=>{ el[k].value=v; });
    update(true);
  });
});

// ---------- Zoom / pan on the price chart (also drives the equity chart) ----------
(function(){
  const cv=document.getElementById('marketChart'), PL=44, PR=10;
  const N=()=>lastDraw?lastDraw.prices.length:0;
  const minSpan=()=>Math.min(1,15/Math.max(1,N()-1));
  function set(a,b){ const sp=Math.min(1,Math.max(minSpan(),b-a)); a=Math.max(0,Math.min(1-sp,a)); view={a,b:a+sp}; redraw(); }
  function zoom(f,fx){ const sp=view.b-view.a, ns=Math.min(1,Math.max(minSpan(),sp*f)), c=view.a+fx*sp; set(c-fx*ns,c-fx*ns+ns); }
  const fxOf=ev=>{const r=cv.getBoundingClientRect(); return Math.max(0,Math.min(1,(ev.clientX-r.left-PL)/(r.width-PL-PR)));};
  cv.addEventListener('wheel',ev=>{ev.preventDefault(); zoom(ev.deltaY>0?1.25:0.8,fxOf(ev));},{passive:false});
  let drag=null;
  cv.addEventListener('pointerdown',ev=>{drag={x:ev.clientX,a:view.a,sp:view.b-view.a}; cv.setPointerCapture(ev.pointerId);});
  cv.addEventListener('pointermove',ev=>{ if(!drag) return; const r=cv.getBoundingClientRect(); const d=(ev.clientX-drag.x)/(r.width-PL-PR)*drag.sp; set(drag.a-d,drag.a-d+drag.sp); });
  ['pointerup','pointercancel'].forEach(t=>cv.addEventListener(t,()=>{drag=null;}));
  cv.addEventListener('dblclick',()=>set(0,1));
  document.getElementById('zIn').onclick=()=>zoom(0.6,0.5);
  document.getElementById('zOut').onclick=()=>zoom(1.66,0.5);
  document.getElementById('zReset').onclick=()=>set(0,1);
})();

// ---------- Hooks for the AI copilot (ai.js) ----------
function classifyRegimes(prices, win=40){
  const r=[]; for(let i=1;i<prices.length;i++) r.push(prices[i]/prices[i-1]-1);
  const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)||1e-9;};
  const allSd=sd(r), segs=[];
  for(let s=0;s<r.length;s+=win){
    const c=r.slice(s,s+win), m=c.reduce((x,y)=>x+y,0)/c.length, v=sd(c);
    let reg;
    if(Math.max(...c.map(Math.abs))>4*allSd) reg='shock';
    else if(v>1.4*allSd) reg='high_vol';
    else if(Math.abs(m/(v/Math.sqrt(c.length)))>1.5) reg='trending';
    else reg='mean_reverting';
    segs.push({regime:reg,start:s,end:Math.min(s+win,prices.length)});
  }
  return segs;
}
window.RL = {
  snapshot(){ const p=getParams(), s=lastSnap; if(!s) return {params:p};
    const r=x=>Math.round(x*100)/100;
    return {params:p, dataSource:s.real?'uploaded real prices':'synthetic', periods:s.n,
      metrics:{totalReturnPct:r(s.m.totalReturn),sharpe:r(s.m.sharpe),maxDrawdownPct:r(s.m.maxDD),trades:s.m.trades,winRatePct:r(s.m.winRate),profitFactor:isFinite(s.m.profitFactor)?r(s.m.profitFactor):'inf',avgWinPct:r(s.m.avgWin),avgLossPct:r(s.m.avgLoss)},
      byRegime:Object.values(s.rperf).map(o=>({regime:o.regime,periods:o.duration,returnPct:o.startEq?r((o.endEq-o.startEq)/o.startEq*100):0,trades:o.trades}))}; },
  apply(a){ const done=[];
    if(a.params) Object.entries(a.params).forEach(([k,v])=>{ if(!el[k]||isNaN(+v)) return;
      const x=Math.min(+el[k].max,Math.max(+el[k].min,+v)); el[k].value=x; done.push(k+'='+fmtVal(k,x)); });
    const strategyOnly = a.params && Object.keys(a.params).every(k=>['ma','sl','tp','ps','cap'].includes(k));
    if(a.reseed || (a.params && !strategyOnly && !customData)) { update(true); if(a.reseed) done.push('new market'); }
    else update(false);
    return done; },
  loadPrices(prices){ customData={prices, segs:classifyRegimes(prices)}; update(false); }
};

window.addEventListener('resize', ()=>update(false));
update(true);
