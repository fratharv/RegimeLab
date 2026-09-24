/* ============================================================
   RegimeLab backend
   The ONLY place the OpenAI API key is used. Never expose it
   to the frontend / browser / GitHub Pages.
   ============================================================ */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "\n[RegimeLab backend] ERROR: OPENAI_API_KEY is not set.\n" +
      "Create a file named \".env\" in the backend/ folder (copy .env.example) " +
      "and put your OpenAI API key in it.\n"
  );
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(",").map((s) => s.trim()),
  })
);

// Keep request bodies small — this endpoint only ever needs a short
// message plus a compact JSON snapshot of the simulator state.
app.use(express.json({ limit: "200kb" }));

/* ---------- allow-listed parameters the AI is permitted to change ---------- */

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

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Strictly whitelist and clamp whatever the model returns. Nothing
// outside PARAM_SPEC's keys can ever reach the frontend from here,
// and no arbitrary code / strings can be injected as "actions".
function sanitizeActions(actions) {
  if (!actions || typeof actions !== "object") return undefined;

  const result = {};

  if (actions.params && typeof actions.params === "object") {
    const cleanParams = {};
    for (const key of Object.keys(PARAM_SPEC)) {
      const raw = actions.params[key];
      if (raw === undefined || raw === null) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      const spec = PARAM_SPEC[key];
      cleanParams[key] = clamp(num, spec.min, spec.max);
    }
    if (Object.keys(cleanParams).length > 0) result.params = cleanParams;
  }

  if (actions.reseed === true) result.reseed = true;

  return Object.keys(result).length > 0 ? result : undefined;
}

/* ---------- prompt construction ---------- */

const SYSTEM_PROMPT = `You are the RegimeLab AI Copilot, embedded inside a synthetic financial-market
research tool called RegimeLab. RegimeLab lets a user shape a synthetic market with
sliders (trend, mean reversion, volatility, shocks, persistence, transition rate,
simulation length, starting capital) and backtest a moving-average strategy
(MA period, stop loss %, take profit %, position size %) against it.

You will be given the CURRENT STATE of the simulator as JSON: parameters, whether
the data is synthetic or a real uploaded CSV, how many bars were used, overall
performance metrics, and a performance breakdown by regime (trending,
mean_reverting, high_vol, shock).

Rules you must follow:
- Only use numbers that appear in the provided state. Never invent performance
  figures, prices, or statistics that are not present in the state.
- Never claim the strategy is guaranteed to be profitable, and never give
  unconditional investment advice. This is a research/education tool.
- If dataSource is "synthetic", make clear that this is a synthetic market unless
  the user has uploaded real data. Never claim to fetch live or real market data —
  if asked for real/live data, point out that the user can upload a CSV of real
  prices via the uploader; you may only approximate a real asset's *character*
  synthetically, and must clearly call that approximation synthetic.
- When the user asks you to change the market or the strategy (e.g. "make it more
  volatile", "shorter moving average", "stress test this"), respond with a short
  natural-language explanation AND an "actions.params" object containing ONLY the
  parameters that should change, using ONLY these exact keys:
  trend, meanrev, vol, shockp, shockm, persist, trans, len, cap, ma, sl, tp, ps.
  Use fractional/absolute values matching these ranges:
  trend 0-1, meanrev 0-1, vol 0.05-1, shockp 0-0.2, shockm 0.01-0.2, persist 0.05-1,
  trans 0-1, len 100-5000, cap 10000-1000000, ma 5-100, sl 0.5-15, tp 0.5-30, ps 5-100.
  Set "reseed": true when you want a freshly generated market with the new
  parameters (typical for market-shape changes); omit it or set false for pure
  strategy-parameter tweaks that should keep the same underlying path when possible.
- When the user only asks for analysis (e.g. "analyze this run", "why is it losing
  money", "which regime hurts most") do NOT include an "actions" field at all —
  just explain using the numbers in the state.
- Never include any field other than "reply" and optionally "actions" in your
  response. Never include explanations, markdown, or code fences outside the JSON.

You must respond with ONLY a single valid JSON object of the exact shape:
{"reply": "string", "actions": {"params": {...}, "reseed": true}}
"actions" is entirely optional and should be omitted when no change is needed.`;

function buildUserPrompt(message, state) {
  return (
    `Current RegimeLab state (JSON):\n${JSON.stringify(state)}\n\n` +
    `User message: ${message}`
  );
}

/* ---------- routes ---------- */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: MODEL });
});

app.post("/api/copilot", async (req, res) => {
  try {
    const { message, state } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Field 'message' must be a non-empty string." });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message is too long." });
    }
    if (state !== undefined && (typeof state !== "object" || state === null)) {
      return res.status(400).json({ error: "Field 'state', if provided, must be an object." });
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(message.trim(), state || {}) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 700,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: "The AI returned a response that could not be parsed." });
    }

    const reply = typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "I wasn't able to form a clear response to that — could you rephrase?";

    const actions = sanitizeActions(parsed.actions);

    const payload = { reply };
    if (actions) payload.actions = actions;

    res.json(payload);
  } catch (err) {
    console.error("[/api/copilot] error:", err && err.message ? err.message : err);
    res.status(500).json({ error: "The Copilot backend hit an unexpected error. Please try again." });
  }
});

// Fallback 404 for anything else
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(PORT, () => {
  console.log(`[RegimeLab backend] listening on http://localhost:${PORT}`);
  console.log(`[RegimeLab backend] using model: ${MODEL}`);
});          user
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.6-luna",

      input,

      max_output_tokens: 500
    });

    const raw = response.output_text || "";

    let parsed;

    try {
      parsed = JSON.parse(
        raw
          .replace(/^```json\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim()
      );
    } catch (error) {
      console.error(
        "OpenAI returned invalid JSON:",
        raw
      );

      return res.status(502).json({
        error: "AI returned invalid JSON"
      });
    }

    if (
      !parsed.reply ||
      typeof parsed.reply !== "string"
    ) {
      return res.status(502).json({
        error: "AI response did not contain a valid reply"
      });
    }

    res.json({
      reply: parsed.reply,
      actions: parsed.actions || undefined
    });

  } catch (error) {
    console.error("OpenAI error:", error);

    res.status(500).json({
      error:
        error.message ||
        "OpenAI request failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `RegimeLab backend running on http://localhost:${PORT}`
  );
});
