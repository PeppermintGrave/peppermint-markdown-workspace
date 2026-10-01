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

const MAX_DOCUMENT_CHARS = 7000;
const MAX_SELECTION_CHARS = 5000;
const MAX_CONVERSATION_MESSAGES = 3;
const MAX_CONVERSATION_CHARS = 1800;

const NORMAL_COMPLETION_TOKENS = 1400;
const HTML_COMPLETION_TOKENS = 2200;

const SYSTEM_PROMPT = `
You are the intelligent document editor assistant inside Peppermint Markdown Studio.

You are NOT a generic chatbot. Your primary job is to understand what the user wants to do inside their current Markdown document and produce a useful editor-ready result.

The active editor mode is supplied with every request:
- Simple Markdown
- HTML Markdown

Treat the active mode as a hard constraint.

GENERAL BEHAVIOR

1. Understand intent semantically.
Do not rely only on exact keywords. Users may phrase requests indirectly, casually, or creatively.

2. Respect the current document and selected text.
Selected text is the primary target when one exists.

3. Do not unnecessarily rewrite unrelated content.

4. Preserve existing meaning and facts.

5. Do not invent facts, browser shortcuts, software features, tools, APIs, commands, or capabilities.

6. Do not turn a small formatting request into a long educational article.

7. When the user asks for an edit or formatting operation, prioritize returning the actual usable Markdown/HTML rather than explaining what you changed.

8. When the user asks a genuine knowledge question, answer normally.

9. When the user asks to write new content, produce the requested content in the active editor format.

10. Keep responses reasonably concise unless the user explicitly asks for detailed content.

SIMPLE MARKDOWN MODE

Supported normal Markdown includes:
- H1-H6 headings
- bold
- italic
- bold + italic
- strikethrough
- inline code
- fenced code blocks
- ordered lists
- unordered lists
- task lists
- blockquotes
- links
- images
- tables
- horizontal rules
- normal Markdown structure

Simple Markdown does NOT reliably provide:
- text colors
- background colors
- highlights
- underline
- arbitrary font sizes
- arbitrary font families
- text alignment
- superscript
- subscript
- custom visual text styling
- arbitrary styled HTML blocks

If the user's underlying intent is an HTML-only visual formatting operation while Simple Markdown mode is active, respond EXACTLY:

Please change to HTML Markdown editor to use this feature.

Do not invent Markdown syntax for HTML-only styling.

HTML MARKDOWN MODE

HTML Markdown supports normal Markdown plus controlled HTML formatting supported by the editor.

Supported visual HTML operations may include:
- text color
- background/highlight color
- underline
- text size
- alignment
- superscript
- subscript
- keyboard-style text
- small text
- styled blocks
- other simple inline HTML styling

Use simple, readable HTML.

For normal text color, prefer:

<span style="color:#HEX">text</span>

For background/highlight:

<span style="background-color:#HEX">text</span>

For underline:

<u>text</u>

For superscript:

<sup>text</sup>

For subscript:

<sub>text</sub>

Do not generate unnecessary wrappers.

IMPORTANT HTML EFFICIENCY RULE

Do NOT wrap every individual word in a separate <span> unless the user explicitly asks for word-by-word coloring.

If a whole sentence or paragraph should have one color, use ONE span around that relevant text.

Bad:
<span style="color:red">This</span> <span style="color:red">is</span> <span style="color:red">a</span> <span style="color:red">sentence</span>

Good:
<span style="color:red">This is a sentence</span>

This saves output tokens and produces cleaner HTML.

EDITOR INTENT EXAMPLES

Requests like:
- "make this red"
- "turn this cyan"
- "give this a yellow highlight"
- "underline this"
- "put this in the middle"
- "center this heading"
- "make this bigger"
- "make this smaller"
- "raise this number"
- "put this number below the line"
- "make this look like a keyboard key"
- "make this stand out"
- "change the text color"
- "style this paragraph"

should be understood as editor formatting requests when the context indicates formatting.

Requests like:
- "what does highlight mean?"
- "what is cyan?"
- "explain colors"
- "what is Markdown?"

are knowledge questions, not formatting commands.

EDITING RULES

1. Preserve the selected text whenever possible.
2. Modify only what the user requested.
3. Preserve Markdown headings, tables, links, lists, code fences, and existing HTML unless they need modification.
4. Never unnecessarily regenerate an entire large document.
5. For a selected-text operation, return the modified selected text or the smallest useful replacement.
6. For a document-wide operation explicitly requested by the user, process the document as needed.
7. Do not add commentary around an editor-ready replacement unless the user asks for an explanation.
8. Do not use unnecessary code fences around ordinary Markdown output.
9. Do not claim a feature exists if it does not.
10. If the requested operation is impossible in the active mode, follow the mode rules above.

OUTPUT SAFETY

Always finish HTML tags correctly.

Never intentionally stop in the middle of:
- an HTML tag
- an HTML attribute
- a Markdown link
- a Markdown image
- a fenced code block

If a task would require an excessively large response, prioritize the user's selected text or the smallest relevant portion instead of generating a massive document.
`;

function clampText(value, maxChars) {
  const text = String(value || "");

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[Context truncated for efficiency.]`;
}

function cleanModelOutput(text) {
  if (!text) {
    return "";
  }

  return text
    .trim()
    .replace(/^```(?:markdown|md|html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function looksLikeHtmlOnlyFormattingRequest(prompt, selection = "") {
  const p = String(prompt || "")
    .toLowerCase()
    .trim();

  if (!p) {
    return false;
  }

  if (
    /^(what|why|how|explain|define|meaning|tell me about)\b/.test(p)
  ) {
    return false;
  }

  const formattingIntent =
    /\b(make|change|turn|set|use|give|apply|add|put|format|style|color|colour|highlight|underline|center|centre|align|resize|enlarge|shrink|bigger|smaller|larger|font|background|bg|text size|text color|text colour|custom color|custom colour|superscript|subscript|keyboard key|keycap|visual|visually|stand out|emphasize|emphasise|should be|in red|in blue|in yellow|in green|in orange|in purple|in pink|in cyan|in teal)\b/
      .test(p);

  const htmlOnly =
    /\b(red|blue|green|yellow|orange|purple|pink|cyan|teal|magenta|white|black|gray|grey|gold|silver)\b/.test(p) ||
    /\b(colou?r|background|highlight|underline|text[- ]?color|text[- ]?size|font[- ]?(size|family)|center|centre|align|bigger|smaller|larger|resize|superscript|subscript|keyboard key|keycap|line[- ]?height|letter[- ]?spacing|text[- ]?shadow|custom style|styled)\b/.test(p);

  if (!htmlOnly) {
    return false;
  }

  return (
    formattingIntent ||
    Boolean(selection) ||
    /\b(this|that|these|those|selected|word|text|sentence|paragraph|heading|title|phrase)\b/.test(
      p
    )
  );
}

function looksLikeHtmlFormattingRequest(prompt, selection = "") {
  const p = String(prompt || "").toLowerCase();

  const visualWords =
    /\b(color|colour|red|blue|green|yellow|orange|purple|pink|cyan|teal|highlight|underline|background|font|size|bigger|smaller|larger|center|centre|align|superscript|subscript|keyboard|keycap|styled|style|visual|visually)\b/;

  const targetWords =
    /\b(this|that|these|those|text|word|sentence|paragraph|heading|title|selected|selection|line|section)\b/;

  return (
    visualWords.test(p) &&
    (targetWords.test(p) || Boolean(selection))
  );
}

function looksLikeWritingRequest(prompt) {
  const p = String(prompt || "").toLowerCase();

  return /\b(write|create|generate|draft|compose|continue|expand|develop|add a section|write a section|make an article|create an article)\b/.test(
    p
  );
}

function looksLikeSimpleEdit(prompt) {
  const p = String(prompt || "").toLowerCase();

  return /\b(improve|rewrite|rephrase|shorten|simplify|fix|correct|grammar|proofread|polish|summarize|summary|translate)\b/.test(
    p
  );
}

function detectRequestType(prompt, selection = "") {
  if (looksLikeHtmlFormattingRequest(prompt, selection)) {
    return "html-formatting";
  }

  if (looksLikeSimpleEdit(prompt)) {
    return "editing";
  }

  if (looksLikeWritingRequest(prompt)) {
    return "writing";
  }

  return "general";
}

function isLikelyTruncated(content) {
  const text = String(content || "").trim();

  if (!text) {
    return false;
  }

  if (/<span\b[^>]*$/.test(text)) {
    return true;
  }

  if (/<(?:u|sup|sub|kbd)\b[^>]*>[^<]*$/.test(text)) {
    return true;
  }

  if (/<span\b[^>]*>[\s\S]*$/.test(text)) {
    const opens = (text.match(/<span\b/gi) || []).length;
    const closes = (text.match(/<\/span>/gi) || []).length;

    if (opens > closes) {
      return true;
    }
  }

  if (/```[^]*$/.test(text)) {
    const fences = (text.match(/```/g) || []).length;

    if (fences % 2 !== 0) {
      return true;
    }
  }

  return false;
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
        error: "GROQ_API_KEY is not configured. Add it to your environment variables."
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

    if (!String(prompt).trim()) {
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

    const selectedMode =
      workspaceMode === "html"
        ? "html"
        : "markdown";

    if (
      selectedMode === "markdown" &&
      looksLikeHtmlOnlyFormattingRequest(prompt, selection)
    ) {
      return res.json({
        ok: true,
        content:
          "Please change to HTML Markdown editor to use this feature.",
        model: selectedModel,
        mode: selectedMode,
        usage: null,
        modeBlocked: true
      });
    }

    const requestType = detectRequestType(
      prompt,
      selection
    );

    const htmlRequest =
      selectedMode === "html" &&
      requestType === "html-formatting";

    const documentLimit = htmlRequest
      ? 5000
      : MAX_DOCUMENT_CHARS;

    const selectionLimit = htmlRequest
      ? 4500
      : MAX_SELECTION_CHARS;

    const boundedSelection = clampText(
      selection,
      selectionLimit
    );

    const boundedDocument = clampText(
      document,
      documentLimit
    );

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      }
    ];

    if (Array.isArray(conversation)) {
      for (
        const item of conversation.slice(
          -MAX_CONVERSATION_MESSAGES
        )
      ) {
        if (
          item &&
          (item.role === "user" ||
            item.role === "assistant") &&
          typeof item.content === "string"
        ) {
          messages.push({
            role: item.role,
            content: clampText(
              item.content,
              MAX_CONVERSATION_CHARS
            )
          });
        }
      }
    }

    const context = [
      `ACTION: ${action}`,
      `REQUEST TYPE: ${requestType}`,
      `EDITOR MODE: ${
        selectedMode === "html"
          ? "HTML Markdown"
          : "Simple Markdown"
      }`,
      "",
      "SELECTED TEXT:",
      boundedSelection || "(nothing selected)",
      "",
      "CURRENT DOCUMENT:",
      boundedDocument || "(empty document)"
    ].join("\n");

    let taskInstruction = "";

    if (requestType === "html-formatting") {
      taskInstruction = `
This is an HTML formatting operation.

Return only the smallest useful Markdown/HTML replacement needed for the requested formatting.

Do not write an essay.
Do not explain HTML.
Do not generate unrelated content.
Do not wrap every word individually unless explicitly requested.
Use one clean HTML element for a continuous piece of text whenever possible.
`;
    } else if (requestType === "editing") {
      taskInstruction = `
This is an editing operation.

Focus on the selected text first.
Return the improved/revised content directly.
Do not add an unrelated explanation unless the user asks for one.
`;
    } else if (requestType === "writing") {
      taskInstruction = `
This is a content-writing operation.

Generate the requested content in the active Markdown mode.
Keep the structure useful for direct insertion into the document.
Do not add unrelated facts or filler.
`;
    } else {
      taskInstruction = `
Treat this as a document-aware request.
Use the current document and selection as context, but do not unnecessarily reproduce the entire document.
`;
    }

    messages.push({
      role: "user",
      content: `${context}

USER REQUEST:
${prompt}

${taskInstruction}

Return a clean, directly usable response.`
    });

    const maxCompletionTokens = htmlRequest
      ? HTML_COMPLETION_TOKENS
      : NORMAL_COMPLETION_TOKENS;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages,
          reasoning_effort: selectedReasoning,
          temperature:
            requestType === "html-formatting"
              ? 0.15
              : 0.25,
          max_completion_tokens:
            maxCompletionTokens
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message ||
        `Groq request failed with HTTP ${response.status}.`;

      if (response.status === 429) {
        const retryAfterHeader =
          response.headers.get("retry-after");

        const retryAfter =
          retryAfterHeader
            ? Number(retryAfterHeader)
            : null;

        return res.status(429).json({
          error: retryAfter
            ? `AI rate limit reached. Please wait about ${retryAfter} seconds and try again.`
            : "AI rate limit reached. Please wait a moment and try again.",
          retryAfter
        });
      }

      return res.status(response.status).json({
        error: message
      });
    }

    const rawContent =
      data?.choices?.[0]?.message?.content || "";

    const content =
      cleanModelOutput(rawContent);

    const finishReason =
      data?.choices?.[0]?.finish_reason || null;

    const truncated =
      finishReason === "length" ||
      isLikelyTruncated(content);

    if (truncated) {
      console.warn(
        "AI response appears truncated.",
        {
          finishReason,
          requestType,
          model: selectedModel
        }
      );
    }

    return res.json({
      ok: true,
      content,
      model: selectedModel,
      mode: selectedMode,
      requestType,
      truncated,
      finishReason,
      usage: data?.usage || null
    });

  } catch (error) {
    console.error("AI request error:", error);

    return res.status(500).json({
      error:
        "The AI request could not be completed.",
      detail: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(PORT, () => {
  console.log(
    `Peppermint Markdown Studio running on port ${PORT}`
  );
});
