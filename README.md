# RegimeLab

**Design the market. Stress the strategy.**

A browser-only synthetic market laboratory. Configure a regime-switching
market (trending / mean-reverting / high-volatility / shock) with live
sliders, run a moving-average crossover strategy against it with
stop-loss / take-profit / position sizing, and see performance broken
down **by regime** — not just one aggregate return number.

No backend, no API keys, no build step. Pure HTML + CSS + vanilla JS,
rendered with `<canvas>`.

## Files

```
regimelab/
├── index.html   # markup
├── style.css    # all styling (dark theme, layout, components)
├── script.js    # market generator, strategy engine, backtester, charts
├── ai.js        # AI Copilot side panel
├── config.js    # AI proxy URL
├── worker/worker.js  # Cloudflare Worker that holds the Qwen key
└── README.md
```

There are no image/graphic assets — the logo is inline SVG in
`index.html` and every chart (price, equity curve, donut) is drawn live
on `<canvas>`, so there's nothing extra to host.

## Run it locally

Just open `index.html` in a browser — everything runs client-side.
(Some browsers restrict `file://` script loading; if `script.js`
doesn't load, serve it locally instead:)

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Host it live on GitHub Pages

1. Create a new repo on GitHub, e.g. `regimelab`.
2. Push these files (add `ai.js` too) to the repo root:
   ```bash
   git init
   git add index.html style.css script.js README.md
   git commit -m "RegimeLab: synthetic market regime lab"
   git branch -M main
   git remote add origin https://github.com/<your-username>/regimelab.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main` / `root`**.
4. Save. Your live URL will be:
   ```
   https://<your-username>.github.io/regimelab/
   ```
   (First deploy can take a minute or two.)

## How it works

- **Regime sequence** — `buildRegimes()` draws segment durations from a
  distribution controlled by the *Regime Persistence* slider, then
  picks the next regime with probability set by *Transition
  Probability*.
- **Market generator** — `genMarket()` walks the price forward period
  by period; drift and volatility per step depend on the active regime
  and the Trend / Mean Reversion / Volatility / Shock sliders.
- **Strategy** — a configurable moving-average crossover
  (`movingAvg()` + `backtest()`) with stop-loss, take-profit and
  position-size-as-%-of-capital.
- **Metrics** — `metricsFor()` computes return, Sharpe, max drawdown,
  win rate, profit factor; `regimePerf()` re-cuts the equity curve by
  regime segment so you can see *where* the strategy's edge (or lack
  of one) actually comes from.
- Every slider re-runs the strategy live; **Run Simulation** reseeds
  the random market so you can stress-test across many draws.

## AI Copilot (Qwen) — no API key for end users

Users just open **✨ AI Copilot** and type ("Apple-like market", "make it
choppier", "analyze this run"). The AI reads the current results, comments,
and moves the sliders. Upload a price CSV (needs a `Close` column) to test
on real data. If the AI is unreachable, a built-in offline parser still handles
common commands.

**Never put your Qwen key in the website code**, because anyone can read it on GitHub Pages.
Instead, the key lives in a tiny free proxy (`worker/worker.js`, Cloudflare Workers):

1. Get a Qwen key at Alibaba Cloud Model Studio and set a spend limit there.
2. Cloudflare dashboard → Workers & Pages → Create Worker → paste `worker/worker.js` → Deploy.
3. Worker → Settings → Variables and Secrets: add secret `QWEN_API_KEY`
   (and optional plain vars `ALLOWED_ORIGIN` = `https://<you>.github.io`,
   `MODEL` = `qwen-plus`, `BASE_URL` for the China region).
4. Put the worker URL in `config.js`, commit, push.

Chart tips: scroll to zoom, drag to pan, double-click to reset.

## Ideas for extending it (didn't fit before the hackathon deadline)

- **Regime Composer** — let the user hand-sequence specific regimes
  and durations instead of a stochastic schedule.
- **Regime Shuffle** — run N simulations with the same statistical
  spec and show the distribution of outcomes (median / best / worst
  case) for robustness testing.
- Pluggable/custom strategies (paste-your-own JS function) in an
  "Advanced Mode".

## License

MIT — do whatever you want with it, good luck at the hackathon.
