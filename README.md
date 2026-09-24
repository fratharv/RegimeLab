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
├── ai.js        # Qwen AI Copilot side panel
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

## AI Copilot (Qwen)

Click **✨ AI Copilot**, open ⚙, paste your Qwen (Alibaba Model Studio /
DashScope) API key, pick the region the key was created in, and chat.
It comments on your results and can change sliders or reseed the market
("make it choppier", "widen my stop loss", "Apple-like market").
Qwen has no live market data, so for a real stock upload a price CSV
(needs a `Close` column, e.g. a Yahoo Finance download) with **Upload prices CSV**.
The key stays in your browser's localStorage; anyone using your hosted
page enters their own key. Never commit a key into the repo.

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
