(() => {
    "use strict";

    const ENDPOINT =
        "http://localhost:3000/api/copilot";

    const panel =
        document.getElementById("copilotPanel");

    const overlay =
        document.getElementById("copilotOverlay");

    const input =
        document.getElementById("copilotInput");

    const log =
        document.getElementById("copilotLog");

    const status =
        document.getElementById("copilotBackendStatus");


    function openCopilot() {

        panel.classList.add("open");
        overlay.classList.add("open");

        setTimeout(
            () => input.focus(),
            250
        );
    }


    function closeCopilot() {

        panel.classList.remove("open");
        overlay.classList.remove("open");
    }


    document
        .getElementById("openCopilotBtn")
        .addEventListener(
            "click",
            openCopilot
        );


    document
        .getElementById("closeCopilotBtn")
        .addEventListener(
            "click",
            closeCopilot
        );


    overlay.addEventListener(
        "click",
        closeCopilot
    );


    function addUserMessage(message) {

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "user-message";

        wrapper.innerHTML = `
            <div class="message-label">YOU</div>
            <p>${escapeHTML(message)}</p>
        `;

        log.appendChild(wrapper);

        log.scrollTop =
            log.scrollHeight;
    }


    function addAIMessage(message) {

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "ai-message";

        wrapper.innerHTML = `
            <div class="message-label">COPILOT</div>
            <p>${escapeHTML(message)}</p>
        `;

        log.appendChild(wrapper);

        log.scrollTop =
            log.scrollHeight;
    }


    function escapeHTML(value) {

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    async function checkBackend() {

        try {

            const response =
                await fetch(
                    "http://localhost:3000/api/health"
                );

            if (!response.ok) {
                throw new Error();
            }

            status.textContent =
                "Backend connected · AI Copilot ready";

        } catch {

            status.textContent =
                "Backend offline · start the backend server";
        }
    }


    async function sendToBackend(message) {

        const response =
            await fetch(
                ENDPOINT,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        message,
                        state:
                            window.RL
                                ? window.RL.snapshot()
                                : {}
                    })
                }
            );

        if (!response.ok) {

            let errorText =
                "The AI request failed.";

            try {

                const data =
                    await response.json();

                if (data.error) {
                    errorText =
                        data.error;
                }

            } catch {}

            throw new Error(errorText);
        }

        return response.json();
    }


    async function send() {

        const message =
            input.value.trim();

        if (!message) {
            return;
        }

        input.value = "";

        addUserMessage(message);

        const thinking =
            document.createElement("div");

        thinking.className =
            "ai-message";

        thinking.innerHTML = `
            <div class="message-label">COPILOT</div>
            <p>Analysing the experiment…</p>
        `;

        log.appendChild(thinking);

        log.scrollTop =
            log.scrollHeight;

        try {

            const data =
                await sendToBackend(message);

            thinking.remove();

            if (data.actions &&
                window.RL) {

                window.RL.apply(
                    data.actions
                );
            }

            addAIMessage(
                data.reply ||
                "The simulation has been updated."
            );

        } catch (error) {

            thinking.remove();

            addAIMessage(
                `I couldn't reach the Copilot backend. ${error.message}`
            );
        }
    }


    document
        .getElementById("copilotSendBtn")
        .addEventListener(
            "click",
            send
        );


    input.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                send();
            }
        }
    );


    document
        .querySelectorAll(".chip")
        .forEach(
            chip => {

                chip.addEventListener(
                    "click",
                    () => {

                        input.value =
                            chip.textContent;

                        send();
                    }
                );
            }
        );


    window.RegimeLabAI = {

        notifyDataLoaded(count, filename) {

            addAIMessage(
                `Loaded ${count.toLocaleString("en-IN")} observations from ${filename}. I can now help interpret the observed series and adjust the experiment.`
            );
        }

    };


    checkBackend();

})();      }
      if (Object.keys(p).length > 0) out.params = p;
    }
    if (actions.reseed === true) out.reseed = true;
    return Object.keys(out).length > 0 ? out : null;
  }

  async function sendToBackend(message) {
    const state = window.RL ? window.RL.snapshot() : null;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, state }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        detail = errBody && errBody.error ? errBody.error : "";
      } catch (e) {
        /* ignore */
      }
      throw new Error(detail || `Backend responded with status ${res.status}.`);
    }

    const data = await res.json();
    if (!data || typeof data.reply !== "string") {
      throw new Error("Backend returned an unexpected response shape.");
    }
    return data;
  }

  async function handleSend(rawMessage) {
    const message = (rawMessage || "").trim();
    if (!message) return;

    appendMessage(message, "msg-user");
    const thinkingEl = appendMessage("Thinking…", "msg-system");

    try {
      const data = await sendToBackend(message);
      thinkingEl.remove();
      appendMessage(data.reply, "msg-ai");

      const safeActions = sanitizeActions(data.actions);
      if (safeActions && window.RL) {
        window.RL.apply(safeActions);
        appendMessage("Applied changes to the simulation.", "msg-system");
      }
      backendReachable = true;
      setBackendStatus("");
    } catch (err) {
      thinkingEl.remove();
      backendReachable = false;
      appendMessage(
        "I couldn't reach the RegimeLab backend, so I can't analyze this run right now. " +
          "The simulator itself still works fully — sliders, backtests and charts are unaffected. " +
          "(" + err.message + ")",
        "msg-error"
      );
      setBackendStatus(
        "Backend unavailable. Set ENDPOINT in ai.js to your deployed backend URL, or start it locally on port 3000."
      );
    }
  }

  function notifyDataLoaded(count, filename) {
    appendMessage(`Loaded ${count} real prices from "${filename}". The Copilot will now reason about this dataset instead of synthetic data.`, "msg-system");
  }

  function wireUI() {
    el("openCopilotBtn").addEventListener("click", openPanel);
    el("closeCopilotBtn").addEventListener("click", closePanel);
    el("copilotOverlay").addEventListener("click", closePanel);

    el("copilotSendBtn").addEventListener("click", () => {
      const input = el("copilotInput");
      handleSend(input.value);
      input.value = "";
    });

    el("copilotInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const input = el("copilotInput");
        handleSend(input.value);
        input.value = "";
      }
    });

    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        openPanel();
        handleSend(chip.getAttribute("data-msg"));
      });
    });
  }

  document.addEventListener("DOMContentLoaded", wireUI);

  window.RegimeLabAI = { notifyDataLoaded };
})();    "reseed": true
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
