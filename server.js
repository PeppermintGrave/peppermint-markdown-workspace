require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
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
const MAX_CONVERSATION_MESSAGES = 4;
const MAX_CONVERSATION_CHARS = 1800;

/*
  Output budgets are intentionally different.

  Tiny requests stay small so they do not waste TPM.
  Large writing requests get more room.
*/
const OUTPUT_TOKENS = {
  tiny: 900,
  normal: 1600,
  html: 2200,
  large: 3200
};

const SYSTEM_PROMPT = `
You are the built-in AI editor assistant for Peppermint Markdown Studio.

You are NOT a generic chatbot.

You are an intelligent document editor, writing assistant, Markdown processor, HTML-Markdown formatter, and document-aware workspace assistant.

Always respect the editor mode supplied by the application.

EDITOR MODES:
- markdown = Simple Markdown
- html = HTML Markdown

Understand what the user is actually asking.

The user may be asking you to:

- create new writing
- edit existing writing
- rewrite text
- fix grammar
- shorten text
- expand text
- summarize
- continue a document
- format Markdown
- apply HTML formatting
- answer a question about the document
- answer a general question

Do NOT automatically rewrite, summarize, continue, or modify the document unless the user asks for it.

DOCUMENT RULES:

- Treat the supplied document as the current working document.
- If selected text exists and the request refers to "this", operate primarily on the selection.
- Preserve unrelated content.
- Preserve meaning and facts unless the user asks for a change.
- Preserve existing structure whenever possible.
- Do not silently delete unrelated sections.
- Do not invent application features.
- Do not invent browser shortcuts.
- Do not invent APIs.
- Do not invent commands.
- Do not invent facts.
- Do not present guesses as facts.
- Be proportional to the user's request.

SIMPLE MARKDOWN MODE:

Use standard Markdown.

Do not use HTML for visual styling.

If the user requests HTML-only visual formatting while in Simple Markdown mode, respond EXACTLY:

Please change to HTML Markdown editor to use this feature.

HTML-only examples include:

- changing text color
- highlighting
- underline
- custom alignment
- custom text size
- custom background
- styled blocks
- custom visual text styling

Do not attempt to approximate HTML-only formatting using unsupported Markdown.

HTML MARKDOWN MODE:

Markdown plus concise, controlled HTML is allowed.

Use HTML only when it actually serves the user's request.

Do not convert ordinary Markdown into unnecessary HTML.

For example:

If the user asks:

"Make this a heading"

use normal Markdown:

## Heading

If the user asks:

"Make this heading blue"

HTML styling is appropriate:

## <span style="color:#35b997">Heading</span>

If the user asks:

"Highlight this sentence"

use:

<mark>This sentence</mark>

HTML EFFICIENCY:

Never wrap every individual word in a separate span unless the user explicitly requests per-word styling.

Prefer one span around a continuous phrase or sentence.

Do not produce huge amounts of unnecessary HTML.

This is important because excessive HTML wastes output tokens and can cause incomplete responses.

WRITING REQUESTS:

When the user explicitly requests a new document, actually create the requested document.

Match:

- requested subject
- tone
- length
- audience
- format
- structure

If the user gives a target word count, follow it as closely as practical.

For large writing requests:

- produce the complete requested document
- do not replace the document with an outline
- do not intentionally stop early
- do not summarize instead of writing
- do not explain how the user could write it
- output the actual requested content

If the user asks for:

"Create a 2,000 word diary"

actually create the diary.

If the user asks for:

"Write a complete article"

write the complete article.

If the user asks for:

"Generate a detailed report"

generate the report.

DOCUMENT EDITING:

When editing existing content:

1. Preserve the original meaning.
2. Preserve existing facts.
3. Preserve the user's voice unless a style change is requested.
4. Preserve unrelated formatting.
5. Modify only what was requested.
6. Do not silently delete information.
7. Do not add unrelated information.
8. Keep Markdown valid.
9. Keep HTML balanced and valid.
10. If selected text exists, prioritize that selection.

GRAMMAR:

If the user asks to fix grammar:

- correct grammar
- correct spelling where appropriate
- preserve meaning
- avoid unnecessarily rewriting the entire passage

REWRITING:

If the user asks for a rewrite:

- preserve the original meaning
- follow the requested style
- do not add unrelated information

SHORTENING:

If the user asks to shorten something:

- remove redundancy
- preserve important information
- preserve the core meaning

EXPANDING:

If the user asks to expand something:

- add relevant information
- maintain the existing subject and tone
- do not pad the document with meaningless sentences

SUMMARIZATION:

If the user asks for a summary:

- summarize the relevant content
- do not rewrite the entire document
- preserve important points

DOCUMENT QUESTIONS:

If the user asks a question about the document, answer the question.

Do not modify the document unless the user asks for modification.

GENERAL QUESTIONS:

You may answer general questions normally.

Do not treat every question as an editing command.

NO HALLUCINATED FEATURES:

Never invent:

- browser shortcuts
- editor buttons
- application features
- Markdown features
- HTML capabilities
- APIs
- commands
- integrations
- undocumented behavior

If something is uncertain, say so.

RESPONSE SIZE:

Be proportional to the request.

Small request:

"Make this blue."

Return a small result.

Grammar request:

"Fix this sentence."

Return the corrected sentence.

Large request:

"Write a 2,000 word diary."

Return the requested large document.

Do not turn small requests into essays.

Do not unnecessarily repeat the entire document.

OUTPUT:

Return the actual answer or document.

Do not prepend unnecessary meta-commentary.

Use clean Markdown.

If a response reaches the model's output limit, preserve as much useful content as possible.

Never intentionally return an empty response.
`;

function clampText(value, max) {
  return String(value ?? "").slice(0, max);
}

function cleanModelOutput(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\u0000/g, "")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
}

function normalizeMode(value) {
  return value === "html" ? "html" : "markdown";
}

function normalizeModel(value) {
  return ALLOWED_MODELS.has(value)
    ? value
    : DEFAULT_MODEL;
}

function normalizeReasoning(value) {
  return ALLOWED_REASONING.has(value)
    ? value
    : "medium";
}

function looksLikeHtmlOnlyFormattingRequest(text) {
  const s = String(text || "").toLowerCase();

  const formattingVerb =
    /\b(make|turn|change|set|color|colour|format|style|highlight|underline|center|centre|align|enlarge|resize)\b/.test(s);

  const formattingTarget =
    /\b(red|blue|green|yellow|orange|purple|pink|cyan|teal|white|black)\b/.test(s) ||
    /\bhighlight(ed|ing)?\b/.test(s) ||
    /\bunderline(d|ing)?\b/.test(s) ||
    /\btext\s*(color|colour)\b/.test(s) ||
    /\bfont\s*(size|color|colour)\b/.test(s) ||
    /\btext\s*(larger|smaller)\b/.test(s) ||
    /\b(center|centre)\b/.test(s) ||
    /\balign\b/.test(s) ||
    /\bcustom\s*(style|color|colour)\b/.test(s);

  return formattingVerb && formattingTarget;
}

function looksLikeLargeWritingRequest(text) {
  const s = String(text || "").toLowerCase();

  const explicitLargeLength =
    /\b(?:1[5-9]\d{2}|2\d{3}|3\d{3,})\s*(?:words?|word)\b/.test(s);

  const largeDocumentType =
    /\b(write|create|generate|make|draft|compose)\b/.test(s) &&
    /\b(diary|essay|article|story|chapter|report|document|guide|journal|biography|review|script)\b/.test(s);

  const explicitLongRequest =
    /\b(detailed|complete|full-length|long|longer|comprehensive|in-depth)\b/.test(s) &&
    /\b(write|create|generate|make|draft|compose)\b/.test(s);

  return (
    explicitLargeLength ||
    largeDocumentType ||
    explicitLongRequest
  );
}

function looksLikeWritingRequest(text) {
  const s = String(text || "").toLowerCase();

  return (
    /\b(write|create|generate|make|draft|compose|continue|expand|extend|develop)\b/.test(s) ||
    /\b(diary|essay|article|story|chapter|report|journal|biography)\b/.test(s)
  );
}

function looksLikeSimpleEdit(text) {
  const s = String(text || "").toLowerCase();

  return /\b(fix|correct|edit|rewrite|rephrase|shorten|simplify|improve|polish|clean up|format)\b/.test(s);
}

function detectRequestType(prompt, mode) {
  if (
    mode === "markdown" &&
    looksLikeHtmlOnlyFormattingRequest(prompt)
  ) {
    return "html_only_formatting";
  }

  if (looksLikeLargeWritingRequest(prompt)) {
    return "large_writing";
  }

  if (looksLikeWritingRequest(prompt)) {
    return "writing";
  }

  if (looksLikeSimpleEdit(prompt)) {
    return "edit";
  }

  if (looksLikeHtmlOnlyFormattingRequest(prompt)) {
    return "html_formatting";
  }

  return "general";
}

function outputBudgetFor(requestType) {
  switch (requestType) {
    case "large_writing":
      return OUTPUT_TOKENS.large;

    case "html_formatting":
      return OUTPUT_TOKENS.html;

    case "writing":
      return OUTPUT_TOKENS.normal;

    case "edit":
      return OUTPUT_TOKENS.normal;

    default:
      return OUTPUT_TOKENS.tiny;
  }
}

app.use(express.json({
  limit: "1mb"
}));

app.use(express.static("public"));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Peppermint Markdown Studio",
    groqConfigured: Boolean(process.env.GROQ_API_KEY)
  });
});

app.post("/api/ai", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "GROQ_API_KEY is not configured."
      });
    }

    const {
      action = "assistant",
      prompt = "",
      document = "",
      selection = "",
      conversation = [],
      model,
      reasoning,
      workspaceMode
    } = req.body || {};

    const userPrompt = clampText(
      prompt,
      6000
    ).trim();

    if (!userPrompt) {
      return res.status(400).json({
        error: "Please enter a request."
      });
    }

    const mode = normalizeMode(workspaceMode);
    const selectedModel = normalizeModel(model);
    const selectedReasoning = normalizeReasoning(reasoning);

    const requestType = detectRequestType(
      userPrompt,
      mode
    );

    if (requestType === "html_only_formatting") {
      return res.json({
        content:
          "Please change to HTML Markdown editor to use this feature.",
        model: selectedModel,
        mode,
        requestType,
        truncated: false,
        finishReason: "stop"
      });
    }

    const maxCompletionTokens =
      outputBudgetFor(requestType);

    const safeDocument = clampText(
      document,
      MAX_DOCUMENT_CHARS
    );

    const safeSelection = clampText(
      selection,
      MAX_SELECTION_CHARS
    );

    const safeConversation =
      Array.isArray(conversation)
        ? conversation
            .filter(
              item =>
                item &&
                typeof item === "object"
            )
            .slice(-MAX_CONVERSATION_MESSAGES)
            .map(item => ({
              role:
                item.role === "assistant"
                  ? "assistant"
                  : "user",
              content: clampText(
                item.content,
                MAX_CONVERSATION_CHARS
              )
            }))
        : [];

    let taskInstruction;

    if (requestType === "large_writing") {
      taskInstruction = `
Create the complete requested document.

Follow any requested word count as closely as practical.

Do not replace the document with an outline.

Do not summarize instead of writing.

Do not intentionally stop early.

Output the finished Markdown document.
`;
    } else if (requestType === "edit") {
      taskInstruction = `
Modify only what the user requested.

Preserve unrelated content and structure.

If selected text is supplied, prioritize that selection.
`;
    } else if (requestType === "html_formatting") {
      taskInstruction = `
Apply only the requested visual formatting.

Keep the HTML concise, valid, and efficient.

Do not rewrite unrelated prose.
`;
    } else {
      taskInstruction = `
Follow the user's request precisely.
`;
    }

    const contextMessage = `
EDITOR MODE:
${mode === "html"
  ? "HTML Markdown"
  : "Simple Markdown"}

ACTION:
${clampText(action, 100)}

REQUEST TYPE:
${requestType}

USER REQUEST:
${userPrompt}

SELECTED TEXT:
${safeSelection || "(none)"}

CURRENT DOCUMENT:
${safeDocument || "(empty)"}

TASK:
${taskInstruction}
`;

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...safeConversation,
      {
        role: "user",
        content: contextMessage
      }
    ];

    const response = await fetch(
      GROQ_API_URL,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          messages,
          reasoning_effort:
            selectedReasoning,

          /*
            Large writing gets more output room.
            Small requests remain cheap.
          */
          max_completion_tokens:
            maxCompletionTokens,

          temperature:
            requestType === "large_writing"
              ? 0.65
              : 0.45
        })
      }
    );

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const providerMessage =
        data?.error?.message ||
        `Groq request failed with HTTP ${response.status}.`;

      if (response.status === 429) {
        return res.status(429).json({
          error:
            "The AI provider rate limit was reached. Please wait a moment and try again.",
          providerError:
            providerMessage,
          requestType,
          retryable: true
        });
      }

      return res.status(
        response.status
      ).json({
        error: providerMessage,
        requestType,
        retryable:
          response.status >= 500
      });
    }

    const choice =
      data?.choices?.[0];

    const content =
      cleanModelOutput(
        choice?.message?.content
      );

    const finishReason =
      choice?.finish_reason ||
      "unknown";

    /*
      Never silently turn an empty provider response
      into an empty AI box.
    */
    if (!content) {
      return res.status(502).json({
        error:
          finishReason === "length"
            ? "The AI reached its output limit before producing usable text. Try a slightly shorter request."
            : "The AI returned an empty response. Please try again.",
        requestType,
        finishReason,
        retryable: true
      });
    }

    return res.json({
      content,
      model: selectedModel,
      mode,
      requestType,

      /*
        The frontend can use this to show
        that the answer reached the model limit.
      */
      truncated:
        finishReason === "length",

      finishReason,

      usage:
        data?.usage || null
    });

  } catch (error) {
    console.error(
      "AI request error:",
      error
    );

    return res.status(500).json({
      error:
        "The AI request failed. Please try again.",

      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : error.message,

      retryable: true
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      process.cwd(),
      "public",
      "index.html"
    )
  );
});

app.listen(
  PORT,
  () => {
    console.log(
      `Peppermint Markdown Studio running on port ${PORT}`
    );
  }
);
