"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

const PORT =
    Number(process.env.PORT) || 3000;

const MODEL =
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna";

const API_KEY =
    process.env.OPENAI_API_KEY;


if (!API_KEY) {

    console.error(
        "\nMissing OPENAI_API_KEY.\n" +
        "Add your API key to backend/.env\n"
    );
}


const client =
    new OpenAI({
        apiKey: API_KEY
    });


app.use(
    cors({
        origin: process.env.ALLOWED_ORIGIN || "*"
    })
);

app.use(
    express.json({
        limit: "1mb"
    })
);


/* ---------------- PARAMETER RULES ---------------- */

const PARAM_SPEC = {

    regime: [
        "trending",
        "mean_reverting",
        "high_vol",
        "shock"
    ],

    trend: {
        min: 0,
        max: 1
    },

    meanrev: {
        min: 0,
        max: 1
    },

    vol: {
        min: 0.05,
        max: 1
    },

    shockp: {
        min: 0,
        max: 0.20
    },

    shockm: {
        min: 0.01,
        max: 0.20
    },

    persist: {
        min: 0.05,
        max: 1
    },

    len: {
        min: 100,
        max: 5000
    },

    cap: {
        min: 10000,
        max: 1000000
    },

    ma: {
        min: 5,
        max: 100
    },

    sl: {
        min: 0.5,
        max: 15
    },

    tp: {
        min: 0.5,
        max: 30
    },

    ps: {
        min: 5,
        max: 100
    }
};


/* ---------------- AI INSTRUCTIONS ---------------- */

const SYSTEM_PROMPT = `
You are the AI Copilot inside RegimeLab.

RegimeLab is an educational quantitative-finance market simulation laboratory.

The user can construct stochastic market environments and test a simple trading strategy against them.

Your job is to:

1. Understand what market experiment the user wants.
2. Explain the experiment briefly and precisely.
3. Change simulation parameters when useful.
4. Never claim that a simulated result proves a real-world trading strategy works.
5. Never invent historical market data.
6. Keep parameter values within the allowed ranges.
7. If the user's request is vague, make a reasonable interpretation rather than asking unnecessary questions.

Available regimes:

- trending
- mean_reverting
- high_vol
- shock

Available parameters:

trend:
0 to 1

meanrev:
0 to 1

vol:
0.05 to 1

shockp:
0 to 0.20

shockm:
0.01 to 0.20

persist:
0.05 to 1

len:
100 to 5000

cap:
10000 to 1000000

ma:
5 to 100

sl:
0.5 to 15

tp:
0.5 to 30

ps:
5 to 100

Interpretation examples:

"Create a strong trending market"
-> regime trending
-> increase trend

"Make it highly volatile"
-> regime high_vol
-> increase vol

"Test mean reversion"
-> regime mean_reverting
-> increase meanrev

"Add frequent shocks"
-> regime shock
-> increase shockp and shockm

"Make the strategy slower"
-> increase ma

"Use tighter risk control"
-> decrease sl and/or tp depending on the requested meaning.

Only include parameters that you actually want to change.

Return JSON with exactly this conceptual structure:

{
  "reply": "short explanation",
  "actions": {
    "regime": "...",
    "trend": number,
    "meanrev": number,
    "vol": number,
    "shockp": number,
    "shockm": number,
    "persist": number,
    "len": number,
    "cap": number,
    "ma": number,
    "sl": number,
    "tp": number,
    "ps": number
  }
}

If no parameter changes are required, actions may be an empty object.
`;


/* ---------------- SANITISATION ---------------- */

function clamp(value, min, max) {

    return Math.min(
        Math.max(
            Number(value),
            min
        ),
        max
    );
}


function sanitiseActions(actions) {

    if (
        !actions ||
        typeof actions !== "object"
    ) {
        return {};
    }

    const clean = {};

    if (
        typeof actions.regime === "string" &&
        PARAM_SPEC.regime.includes(
            actions.regime
        )
    ) {

        clean.regime =
            actions.regime;
    }

    for (
        const key of Object.keys(PARAM_SPEC)
    ) {

        if (key === "regime") {
            continue;
        }

        if (
            actions[key] === undefined
        ) {
            continue;
        }

        const spec =
            PARAM_SPEC[key];

        const value =
            Number(actions[key]);

        if (!Number.isFinite(value)) {
            continue;
        }

        clean[key] =
            clamp(
                value,
                spec.min,
                spec.max
            );
    }

    return clean;
}


/* ---------------- HEALTH ---------------- */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            ok: true,
            service: "RegimeLab Copilot",
            model: MODEL
        });
    }
);


/* ---------------- COPILOT ---------------- */

app.post(
    "/api/copilot",
    async (req, res) => {

        try {

            if (!API_KEY) {

                return res
                    .status(500)
                    .json({
                        error:
                            "OPENAI_API_KEY is missing from backend/.env"
                    });
            }


            const message =
                typeof req.body.message === "string"
                    ? req.body.message.trim()
                    : "";


            if (!message) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Please provide a message."
                    });
            }


            if (message.length > 2000) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Message is too long."
                    });
            }


            const currentState =
                req.body.state || {};


            const userPrompt = `
CURRENT REGIMELAB STATE:

${JSON.stringify(
    currentState,
    null,
    2
)}

USER REQUEST:

${message}

Configure the experiment according to the user's request.
Return valid JSON only.
`;


            const response =
                await client.responses.create({

                    model: MODEL,

                    input: [
                        {
                            role: "system",
                            content: [
                                {
                                    type: "input_text",
                                    text: SYSTEM_PROMPT
                                }
                            ]
                        },
                        {
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: userPrompt
                                }
                            ]
                        }
                    ],

                    text: {
                        format: {
                            type: "json_schema",
                            name: "regimelab_copilot",
                            strict: true,
                            schema: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                    reply: {
                                        type: "string"
                                    },
                                    actions: {
                                        type: "object",
                                        additionalProperties: false,
                                        properties: {
                                            regime: {
                                                type: [
                                                    "string",
                                                    "null"
                                                ]
                                            },
                                            trend: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            meanrev: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            vol: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            shockp: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            shockm: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            persist: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            len: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            cap: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            ma: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            sl: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            tp: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            },
                                            ps: {
                                                type: [
                                                    "number",
                                                    "null"
                                                ]
                                            }
                                        },
                                        required: [
                                            "regime",
                                            "trend",
                                            "meanrev",
                                            "vol",
                                            "shockp",
                                            "shockm",
                                            "persist",
                                            "len",
                                            "cap",
                                            "ma",
                                            "sl",
                                            "tp",
                                            "ps"
                                        ]
                                    }
                                },
                                required: [
                                    "reply",
                                    "actions"
                                ]
                            }
                        }
                    },

                    max_output_tokens: 700
                });


            const raw =
                response.output_text;


            if (!raw) {

                return res
                    .status(502)
                    .json({
                        error:
                            "The AI returned an empty response."
                    });
            }


            let parsed;

            try {

                parsed =
                    JSON.parse(raw);

            } catch {

                return res
                    .status(502)
                    .json({
                        error:
                            "The AI response could not be parsed."
                    });
            }


            const actions =
                sanitiseActions(
                    parsed.actions
                );


            return res.json({

                reply:
                    typeof parsed.reply === "string"
                        ? parsed.reply
                        : "Experiment configured.",

                actions

            });

        }

        catch (error) {

            console.error(
                "Copilot error:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        error?.message ||
                        "AI Copilot request failed."
                });
        }
    }
);


/* ---------------- START ---------------- */

app.listen(
    PORT,
    () => {

        console.log(
            `\nRegimeLab backend running at http://localhost:${PORT}`
        );

        console.log(
            `Model: ${MODEL}\n`
        );
    }
);
