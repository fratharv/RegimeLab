require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

const PORT = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "RegimeLab AI Copilot"
  });
});

app.post("/api/copilot", async (req, res) => {
  try {
    const {
      system,
      history = [],
      state,
      user
    } = req.body;

    if (!user) {
      return res.status(400).json({
        error: "Missing user message"
      });
    }

    const currentState = JSON.stringify(
      state || {},
      null,
      2
    );

    const input = [
      {
        role: "system",
        content: system
      },

      ...history.slice(-8),

      {
        role: "user",
        content:
          "CURRENT STATE:\n" +
          currentState +
          "\n\nUSER:\n" +
          user
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
