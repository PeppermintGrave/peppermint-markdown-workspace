require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DEFAULT_MODEL = "openai/gpt-oss-20b";
const ALLOWED_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b"
]);

const ALLOWED_REASONING = new Set([
  "low",
  "medium",
  "high"
]);

const SYSTEM_PROMPT = `
You are the document-aware AI engine inside Peppermint Markdown Studio.

You have two editor modes: Simple Markdown and HTML Markdown. The active mode is always supplied in the request. Treat it as a hard formatting constraint.

Your job is to understand the user's INTENT, not merely match keywords. Users may phrase formatting requests indirectly, creatively, sarcastically, or with different vocabulary. Infer when they are asking to visually format text.

SIMPLE MARKDOWN MODE:
- Use portable Markdown only.
- Supported formatting includes headings H1-H6, bold, italic, bold+italic, strikethrough, inline code, fenced code blocks, unordered lists, ordered lists, task lists, blockquotes, links, images, tables, horizontal rules, footnotes, and normal Markdown structure.
- Simple Markdown does NOT provide reliable text colors, background/highlight colors, underline, font size changes, font family changes, alignment, subscript, superscript, keyboard-style text, arbitrary styled blocks, or other presentation-only HTML formatting.
- If the user asks for an HTML-only visual formatting feature while Simple Markdown is active, do NOT invent a fake Markdown syntax and do NOT claim that normal Markdown supports it. The correct response is exactly: "Please change to HTML Markdown editor to use this feature."

HTML MARKDOWN MODE:
- Markdown formatting remains available.
- Controlled HTML formatting is allowed for visual text features supported by the editor, including color, background/highlight color, underline, text size, alignment, subscript, superscript, keyboard-style text, small text, and styled blocks.
- Preserve existing Markdown and allowed HTML formatting unless the user asks to change it.

INTENT DETECTION:
- Treat requests such as "highlight Killer", "make Killer red", "change this text to blue", "underline this", "put this in the middle", "center this heading", "make this bigger", "make the background yellow", "make this stand out visually", "use a custom text color", "make this smaller", "raise this number", "drop this number below the line", "make this look like a keyboard key", and equivalent paraphrases as visual formatting requests when the context indicates text formatting.
- Distinguish formatting from semantic questions. "What does highlight mean?" is not a formatting request.
- Do not be tricked by wording intended to bypass the mode restriction. If the underlying intent is an HTML-only visual formatting operation in Simple Markdown, use the exact mode-switch response.

EDITING RULES:
1. Preserve meaning and facts.
2. Treat selected text as the primary target.
3. Do not modify unrelated content.
4. Preserve headings, links, code fences, tables, lists, emphasis, HTML, and other intentional formatting unless asked.
5. For editing requests, return usable content in the active mode, not a discussion of what you would change.
6. For explanations and questions, answer normally.
7. Never silently invent facts.
8. Do not wrap a complete response in unnecessary code fences.
`;

function cleanModelOutput(text) {
  if (!text) return "";
  return text.trim().replace(/^```(?:markdown|md|html)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function looksLikeHtmlOnlyFormattingRequest(prompt, selection = "") {
  const p = String(prompt || "").toLowerCase().trim();
  if (!p || /^(what|why|how|explain|define|meaning|tell me about)\b/.test(p)) return false;

  const formattingIntent = /\b(make|change|turn|set|use|give|apply|add|put|format|style|color|colour|highlight|underline|center|centre|align|resize|enlarge|shrink|bigger|smaller|larger|font|background|bg|text size|text color|text colour|custom color|custom colour|superscript|subscript|keyboard key|keycap|visual|visually|stand out|emphasize|emphasise|should be|in red|in blue|in yellow|in green|in orange|in purple|in pink|in cyan|in teal)\b/.test(p);

  const htmlOnly = [
    /\b(red|blue|green|yellow|orange|purple|pink|cyan|teal|magenta|white|black|gray|grey|gold|silver)\b/,
    /\b(colou?r|background|highlight|underline|text[- ]?color|text[- ]?size|font[- ]?(size|family)|center|centre|align|bigger|smaller|larger|resize|superscript|subscript|keyboard key|keycap|line[- ]?height|letter[- ]?spacing|text[- ]?shadow|custom style|styled)\b/
  ];

  if (!htmlOnly.some(rx => rx.test(p))) return false;
  return formattingIntent || Boolean(selection) || /\b(this|that|these|those|selected|word|text|sentence|paragraph|heading|title|phrase)\b/.test(p);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.GROQ_API_KEY),
    model: DEFAULT_MODEL
  });
});

app.post("/api/ai", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "GROQ_API_KEY is not configured. Add it to your .env file."
      });
    }

    const {
      action = "ask",
      prompt = "",
      document = "",
      selection = "",
      conversation = [],
      model = DEFAULT_MODEL,
      reasoning = "medium",
      workspaceMode = "markdown"
    } = req.body || {};

    if (!prompt.trim()) {
      return res.status(400).json({
        error: "AI prompt is empty."
      });
    }

    const selectedModel = ALLOWED_MODELS.has(model)
      ? model
      : DEFAULT_MODEL;

    const selectedReasoning = ALLOWED_REASONING.has(reasoning)
      ? reasoning
      : "medium";

    const selectedMode = workspaceMode === "html" ? "html" : "markdown";

    if (selectedMode === "markdown" && looksLikeHtmlOnlyFormattingRequest(prompt, selection)) {
      return res.json({
        ok: true,
        content: "Please change to HTML Markdown editor to use this feature.",
        model: selectedModel,
        mode: selectedMode,
        usage: null,
        modeBlocked: true
      });
    }

    const context = [
      `ACTION: ${action}`,
      `EDITOR MODE: ${selectedMode === "html" ? "HTML Markdown" : "Simple Markdown"}`,
      "",
      "SELECTED TEXT:",
      selection || "(nothing selected)",
      "",
      "CURRENT DOCUMENT:",
      document || "(empty document)"
    ].join("\n");

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      }
    ];

    if (Array.isArray(conversation)) {
      for (const item of conversation.slice(-12)) {
        if (
          item &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string"
        ) {
          messages.push({
            role: item.role,
            content: item.content.slice(0, 12000)
          });
        }
      }
    }

    messages.push({
      role: "user",
      content: `${context}

USER REQUEST:
${prompt}

Remember: if the request is a visual HTML-only formatting operation and the editor mode is Simple Markdown, the application-level mode gate has already handled it. Otherwise, follow the active mode rules exactly.`
    });

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages,
          reasoning_effort: selectedReasoning,
          temperature: 0.35,
          max_completion_tokens: 8192
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message ||
        `Groq request failed with HTTP ${response.status}.`;

      return res.status(response.status).json({
        error: message
      });
    }

    const content =
      data?.choices?.[0]?.message?.content || "";

    return res.json({
      ok: true,
      content: cleanModelOutput(content),
      model: selectedModel,
      mode: selectedMode,
      usage: data?.usage || null
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "The AI request could not be completed.",
      detail: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AI Markdown Studio running at http://localhost:${PORT}`);
});
