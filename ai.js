// RegimeLab AI Copilot
// Frontend client -> your backend -> OpenAI API

(function () {
  const $ = id => document.getElementById(id);

  // Your backend URL.
  // When testing locally:
  // http://localhost:3000/api/copilot
  //
  // When deployed:
  // https://YOUR-BACKEND-DOMAIN/api/copilot
  const ENDPOINT =
    window.REGIMELAB_AI_URL ||
    "http://localhost:3000/api/copilot";

  const SYS = `
You are the AI Copilot inside RegimeLab.

RegimeLab is a synthetic-market laboratory for testing trading strategies
across different market regimes.

The available regimes are:
- trending
- mean_reverting
- high_vol
- shock

The user can control:
- trend
- mean reversion
- volatility
- shock probability
- shock magnitude
- persistence
- regime transition probability
- simulation length
- initial capital
- moving-average period
- stop loss
- take profit
- position size

The current strategy is a moving-average based strategy.

You receive CURRENT STATE with every request.

Your job:
1. Understand what the current simulation is doing.
2. Explain important performance results briefly.
3. Suggest useful parameter changes.
4. Apply changes when the user explicitly asks you to change the simulation.
5. Never invent performance numbers.
6. Only discuss numbers that exist in CURRENT STATE.
7. If the user asks for a real stock, explain that RegimeLab does not automatically
   retrieve live market data and suggest uploading a CSV if exact historical data
   is required.
8. Keep responses below 120 words.

IMPORTANT:
Return ONLY valid JSON.

Format:

{
  "reply": "short explanation",
  "actions": {
    "params": {
      "trend": 0.8,
      "meanrev": 0.2
    },
    "reseed": true
  }
}

If no changes are necessary, omit "actions".

Valid parameter ranges:

trend: 0-1
meanrev: 0-1
vol: 0.05-1
shockp: 0-0.2
shockm: 0.01-0.2
persist: 0.05-1
trans: 0-1
len: 100-5000
cap: 10000-1000000
ma: 5-100
sl: 0.5-15
tp: 0.5-30
ps: 5-100

Examples:

"make it strongly trending"
=> high trend, low mean reversion

"make it choppy"
=> low trend, high mean reversion

"make it stressful"
=> increase volatility and possibly shocks

"add crashes"
=> increase shock probability and shock magnitude

"make the strategy more conservative"
=> consider smaller position size and/or tighter risk controls

Do not claim that a parameter change guarantees profitability.
`;

  let hist = [];
  let busy = false;

  function toggle(open) {
    $("aiPanel").classList.toggle("open", open);
    document.body.classList.toggle("ai-open", open);

    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 250);
  }

  $("aiBtn").onclick = () => {
    toggle(true);

    if (!$("aiLog").children.length) {
      add(
        "sys",
        "Tell me what market to build, what to change, or ask me to analyse the current run."
      );
    }
  };

  $("aiClose").onclick = () => toggle(false);

  function add(cls, text, applied) {
    const d = document.createElement("div");
    d.className = "msg " + cls;

    const main = document.createElement("span");
    main.textContent = text;

    d.appendChild(main);

    if (applied && applied.length) {
      const s = document.createElement("span");
      s.className = "applied";
      s.textContent = "Applied: " + applied.join(", ");
      d.appendChild(s);
    }

    $("aiLog").appendChild(d);
    $("aiLog").scrollTop = 1e9;

    return d;
  }

  // Local fallback.
  // This keeps common commands working if your backend is offline.
  function localIntent(t) {
    t = t.toLowerCase();

    const p = {};

    const has = (...words) =>
      words.some(word => t.includes(word));

    if (has("apple", "aapl")) {
      Object.assign(p, {
        trend: 0.6,
        meanrev: 0.2,
        vol: 0.8,
        shockp: 0.03,
        shockm: 0.07
      });
    }

    if (has("trending", "uptrend", "bull")) {
      Object.assign(p, {
        trend: 0.85,
        meanrev: 0.1
      });
    }

    if (has("sideways", "choppy", "mean reverting", "mean-reverting", "range")) {
      Object.assign(p, {
        trend: 0.15,
        meanrev: 0.85
      });
    }

    if (has("volatile", "volatility", "harder", "stress", "stressful")) {
      p.vol = 0.9;
    }

    if (has("calm", "low vol", "stable")) {
      p.vol = 0.2;
    }

    if (has("crash", "crashes", "shock", "shocks")) {
      Object.assign(p, {
        shockp: 0.15,
        shockm: 0.18
      });
    }

    if (has("tight stop")) {
      p.sl = 1;
    }

    if (has("wide stop", "wider stop")) {
      p.sl = 6;
    }

    if (has("longer", "more data", "1000 periods")) {
      p.len = 3000;
    }

    if (Object.keys(p).length) {
      return {
        reply: "Backend unavailable. I applied the closest local interpretation of your request.",
        actions: {
          params: p,
          reseed: true
        }
      };
    }

    return {
      reply:
        "The OpenAI backend is unavailable. Try reconnecting the backend or use a command such as “make it trending” or “add shocks”."
    };
  }

  async function ask(text) {
    if (busy || !text.trim()) return;

    busy = true;
    $("aiSend").disabled = true;

    add("user", text);

    const wait = add("sys", "Thinking…");

    let out;

    try {
      const currentState = RL.snapshot();

      const response = await fetch(ENDPOINT, {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          system: SYS,

          history: hist.slice(-8),

          state: currentState,

          user: text
        })
      });

      if (!response.ok) {
        throw new Error("Backend returned HTTP " + response.status);
      }

      const data = await response.json();

      if (!data.reply) {
        throw new Error("Invalid backend response");
      }

      out = data;

    } catch (error) {
      console.warn("RegimeLab AI:", error);

      out = localIntent(text);
    }

    wait.remove();

    let applied = [];

    if (out.actions) {
      applied = RL.apply(out.actions);
    }

    add(
      "bot",
      out.reply || "Done.",
      applied
    );

    hist.push(
      {
        role: "user",
        content: text
      },
      {
        role: "assistant",
        content: out.reply || ""
      }
    );

    busy = false;
    $("aiSend").disabled = false;
  }

  $("aiSend").onclick = () => {
    const text = $("aiText").value;

    $("aiText").value = "";

    ask(text);
  };

  $("aiText").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("aiSend").click();
    }
  });

  document
    .querySelectorAll(".ai-chips button[data-q]")
    .forEach(button => {
      button.onclick = () => ask(button.dataset.q);
    });

  // ---------------------------------------------------------
  // CSV LOADER
  // ---------------------------------------------------------

  $("aiCsvBtn").onclick = () => {
    $("aiCsv").click();
  };

  $("aiCsv").onchange = async e => {
    const file = e.target.files[0];

    if (!file) return;

    try {
      const rows = (await file.text())
        .trim()
        .split(/\r?\n/)
        .map(line =>
          line
            .split(/[,;\t]/)
            .map(cell =>
              cell
                .trim()
                .replace(/^"|"$/g, "")
            )
        );

      const head = rows[0].map(h =>
        h.toLowerCase()
      );

      let closeIndex = head.findIndex(
        h =>
          h === "close" ||
          h === "adj close" ||
          h === "close/last" ||
          h === "price"
      );

      const hasHeader =
        isNaN(parseFloat(rows[0][0])) &&
        isNaN(
          parseFloat(
            rows[0][rows[0].length - 1]
          )
        );

      let body = hasHeader
        ? rows.slice(1)
        : rows;

      if (closeIndex < 0) {
        closeIndex = rows[0].length - 1;
      }

      let prices = body
        .map(row =>
          parseFloat(
            String(row[closeIndex])
              .replace(/[$₹,]/g, "")
          )
        )
        .filter(
          value =>
            isFinite(value) &&
            value > 0
        );

      if (prices.length < 100) {
        throw new Error(
          "Need at least 100 valid closing prices."
        );
      }

      prices = prices.slice(-5000);

      RL.loadPrices(prices);

      add(
        "sys",
        "Loaded " +
          prices.length +
          " real prices from " +
          file.name +
          ". Regimes were auto-detected."
      );

      ask(
        "I just loaded real price data. Analyse how my strategy performs on it."
      );

    } catch (error) {
      add(
        "err",
        "Could not read CSV: " +
          error.message
      );
    }

    e.target.value = "";
  };

})();
