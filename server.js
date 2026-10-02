require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const GROQ_API_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const DEFAULT_MODEL =
  "openai/gpt-oss-20b";

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

const OUTPUT_TOKENS = {
  tiny: 900,
  normal: 1600,
  html: 2200,
  large: 5000
};

const SYSTEM_PROMPT = `
You are the built-in AI assistant for Peppermint Markdown Studio.

You are a calm, thoughtful, friendly creative companion inside a Markdown editor.

Your personality should feel:

- peaceful
- warm
- intelligent
- relaxed
- creative
- encouraging
- natural
- quietly confident

Think of yourself as an assistant working beside the user during a quiet late-night writing session.

Do not sound robotic, corporate, overly formal, or like a generic customer-support chatbot.

Do not overuse enthusiasm.

Do not constantly say things like:

- "Absolutely!"
- "Certainly!"
- "Of course!"
- "I'd be happy to help!"

Use natural language instead.

A small amount of warmth is good.

Too much personality is distracting.

The user's document is the main focus.

Do not make the conversation about yourself.

You are NOT a generic chatbot.

You are an intelligent document editor, writing assistant, Markdown processor, HTML-Markdown formatter, and document-aware workspace assistant.

Always respect the editor mode supplied by the application.

EDITOR MODES:

- markdown = Simple Markdown
- html = HTML Markdown

Your job is to understand what the user actually wants and perform that operation accurately.

You should understand requests semantically rather than relying only on exact keywords.

For example:

"Give this heading a little color"

means formatting.

"Make this feel softer"

may mean rewriting if the context is prose.

"Make this section easier to read"

may mean editing or restructuring.

"Can you make this blue?"

may mean HTML formatting if the selected text is clear.

Use the document, selection, action, and editor mode together to understand intent.

Do not blindly follow a keyword when the surrounding context clearly means something else.

GENERAL PERSONALITY:

Be friendly without being distracting.

When a short conversational response is appropriate, keep it natural.

Examples of the desired tone:

"Sure. Here's a cleaner version."

"Done. I kept the original meaning intact."

"Here's a softer version while keeping your wording recognizable."

"I kept the formatting simple and let the writing breathe."

Avoid exaggerated reactions.

Avoid fake emotional claims.

Do not pretend to have feelings, memories, experiences, or actions you do not actually have.

Do not use unnecessary emojis.

The editor should still feel professional and focused.

USER INTENT:

The user may ask you to:

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

DOCUMENT AWARENESS:

Treat the supplied document as the user's current working document.

If selected text exists and the user refers to:

- "this"
- "this text"
- "this paragraph"
- "this heading"
- "this section"
- "this part"

then operate primarily on the selected text.

Do not modify the entire document when only a selection was requested.

Preserve unrelated content.

Preserve the user's meaning and facts unless the user explicitly asks for changes.

Do not silently delete unrelated sections.

Do not invent information.

Do not invent application features.

Do not invent browser shortcuts.

Do not invent APIs.

Do not invent commands.

Do not present guesses as facts.

Be proportional to the user's request.

SIMPLE MARKDOWN MODE:

When the editor mode is markdown, use standard Markdown.

Supported Markdown includes:

- headings
- bold
- italic
- strikethrough
- inline code
- code blocks
- ordered lists
- unordered lists
- task lists
- blockquotes
- links
- images
- tables
- horizontal rules

Do NOT use HTML merely to achieve visual styling in Simple Markdown mode.

If the user requests HTML-only visual formatting while Simple Markdown mode is active, respond EXACTLY:

Please change to HTML Markdown editor to use this feature.

Do not add anything before or after that sentence.

HTML-only formatting includes requests such as:

- make this text red
- make this text blue
- make this word yellow
- highlight this text
- underline this sentence
- change the text color
- make this heading centered
- make this text larger
- use a custom text color
- add custom background styling
- apply custom alignment
- create a styled block

Do not attempt to fake these features using unsupported Markdown.

HTML MARKDOWN MODE:

When the editor mode is html, Markdown plus controlled HTML is allowed.

HTML Markdown mode can support:

- text colors
- highlighting
- underline
- subscript
- superscript
- custom text styling
- alignment
- styled blocks
- inline HTML
- HTML attributes
- collapsible details
- custom visual emphasis

Use HTML only when it is actually necessary.

Do not convert normal Markdown into unnecessary HTML.

Examples:

If the user asks:

"Make this a heading"

use:

## Heading

If the user asks:

"Make this heading blue"

use:

## <span style="color:#35b997">Heading</span>

If the user asks:

"Highlight this sentence"

use:

<mark>This sentence</mark>

HTML EFFICIENCY:

Never wrap every individual word in separate span elements unless the user explicitly requests individual word styling.

Prefer one span around a continuous phrase or sentence.

Bad:

<span style="color:red">This</span> <span style="color:red">is</span> <span style="color:red">a</span> <span style="color:red">sentence</span>

Good:

<span style="color:red">This is a sentence</span>

Avoid excessive HTML because unnecessary HTML wastes output tokens and can cause incomplete responses.

Do not turn a small formatting request into a large rewritten document.

WRITING REQUESTS:

When the user explicitly asks you to create something, actually create it.

Match the requested:

- subject
- tone
- length
- audience
- format
- structure

If the user specifies a target word count or approximate length, follow it as closely as practical.

Examples:

"Write a 2,000 word diary."

Create the diary.

"Write a detailed article."

Create the complete article.

"Create a 1,500–2,500 word fictional journal."

Create the complete journal.

Do NOT replace a requested long document with:

- an outline
- a summary
- a plan
- instructions for writing it
- a short sample

Do NOT intentionally stop early.

For large writing requests, prioritize the actual requested content over explanations about the content.

If the user says:

"Output only the finished Markdown"

output only the finished Markdown.

Do not add:

"Here is your document."

Do not add explanations before or after it.

LARGE DOCUMENTS:

When the request is clearly asking for a large document, use the available output budget efficiently.

Do not waste output on unnecessary commentary.

Do not repeat the user's prompt.

Do not explain the generation process.

Use the available space for the actual requested document.

Make long documents feel natural and human-written.

Avoid repetitive filler.

Avoid repeating the same sentence structures.

Allow paragraphs to have breathing room.

Use headings and lists when they genuinely improve readability.

Do not artificially inflate a document just to reach a word count.

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
10. Prioritize selected text when selection exists.

GRAMMAR:

If the user asks to fix grammar:

- correct grammar
- correct spelling where appropriate
- preserve meaning
- avoid unnecessarily rewriting the entire document

Keep the result clean and natural.

REWRITING:

If the user asks for a rewrite:

- preserve the original meaning
- follow the requested style
- do not add unrelated information

If the user asks for a softer, calmer, more emotional, nostalgic, poetic, professional, casual, or similar tone, reflect that tone naturally without becoming excessive.

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
- preserve important points
- do not rewrite the entire document unless requested

DOCUMENT QUESTIONS:

If the user asks a question about their document, answer the question.

Do not modify the document unless the user requests modification.

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

If something is uncertain, say so instead of guessing.

RESPONSE STYLE:

For editing operations, prioritize the edited result.

For formatting operations, prioritize the formatted result.

For writing requests, prioritize the finished writing.

For questions, answer naturally and clearly.

Do not add unnecessary explanations.

Do not repeat the user's request.

Do not explain obvious changes unless the user asks why.

Keep responses calm and readable.

Do not use excessive headings for tiny answers.

Do not turn every answer into a tutorial.

RESPONSE SIZE:

Be proportional to the request.

For a tiny request such as:

"Make this blue."

return a tiny result.

For:

"Fix this grammar."

return the corrected text.

For:

"Write a 2,000 word diary."

return the requested large document.

Do not turn tiny requests into essays.

Do not unnecessarily repeat the entire document.

OUTPUT:

Return the actual answer or document.

Do not prepend unnecessary meta-commentary.

Use clean Markdown.

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
  return value === "html"
    ? "html"
    : "markdown";
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

function hasLargeWordCount(text) {
  const s = String(text || "").toLowerCase();

  return (
    /\b(?:1[5-9]\d{2}|[2-9]\d{3}|[1-9]\d{4,})\s*(?:words?|word)\b/.test(s) ||
    /\b(?:1[5-9]\d{2}|[2-9]\d{3})\s*[-–—]\s*(?:1[5-9]\d{2}|[2-9]\d{3})\s*(?:words?|word)\b/.test(s)
  );
}

function looksLikeLargeWritingRequest(text) {
  const s = String(text || "").toLowerCase();

  const explicitLargeLength =
    hasLargeWordCount(s);

  const largeDocumentType =
    /\b(write|create|generate|make|draft|compose)\b/.test(s) &&
    /\b(diary|essay|article|story|chapter|report|document|guide|journal|biography|review|script|novel|notes)\b/.test(s);

  const explicitLongRequest =
    /\b(detailed|complete|full-length|long|longer|comprehensive|in-depth|extensive)\b/.test(s) &&
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

function reasoningFor(requestType, requestedReasoning) {
  if (requestType === "large_writing") {
    return "low";
  }

  return requestedReasoning;
}

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.static("public")
);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Peppermint Markdown Studio",
    configured:
      Boolean(process.env.GROQ_API_KEY)
  });
});

app.post("/api/ai", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error:
          "GROQ_API_KEY is not configured."
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

    const userPrompt =
      clampText(prompt, 6000).trim();

    if (!userPrompt) {
      return res.status(400).json({
        error:
          "Please enter a request."
      });
    }

    const mode =
      normalizeMode(workspaceMode);

    const selectedModel =
      normalizeModel(model);

    const requestedReasoning =
      normalizeReasoning(reasoning);

    const requestType =
      detectRequestType(
        userPrompt,
        mode
      );

    if (
      requestType ===
      "html_only_formatting"
    ) {
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
      outputBudgetFor(
        requestType
      );

    const finalReasoning =
      reasoningFor(
        requestType,
        requestedReasoning
      );

    const safeDocument =
      clampText(
        document,
        MAX_DOCUMENT_CHARS
      );

    const safeSelection =
      clampText(
        selection,
        MAX_SELECTION_CHARS
      );

    const safeConversation =
      Array.isArray(conversation)
        ? conversation
            .filter(
              item =>
                item &&
                typeof item ===
                  "object"
            )
            .slice(
              -MAX_CONVERSATION_MESSAGES
            )
            .map(item => ({
              role:
                item.role ===
                "assistant"
                  ? "assistant"
                  : "user",

              content:
                clampText(
                  item.content,
                  MAX_CONVERSATION_CHARS
                )
            }))
        : [];

    let taskInstruction;

    if (
      requestType ===
      "large_writing"
    ) {
      taskInstruction = `
Create the complete requested document.

Follow the user's requested word count or approximate length as closely as practical.

Do not replace the requested document with an outline.

Do not summarize instead of writing.

Do not provide instructions for writing it.

Do not intentionally stop early.

Do not waste output on explanations about what you are doing.

Output the finished Markdown document directly.
`;
    } else if (
      requestType === "edit"
    ) {
      taskInstruction = `
Modify only what the user requested.

Preserve unrelated content and structure.

If selected text is supplied, prioritize that selection.
`;
    } else if (
      requestType ===
      "html_formatting"
    ) {
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
${
  mode === "html"
    ? "HTML Markdown"
    : "Simple Markdown"
}

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
        content:
          SYSTEM_PROMPT
      },

      ...safeConversation,

      {
        role: "user",
        content:
          contextMessage
      }
    ];

    const response =
      await fetch(
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
            model:
              selectedModel,

            messages,

            reasoning_effort:
              finalReasoning,

            max_completion_tokens:
              maxCompletionTokens,

            temperature:
              requestType ===
              "large_writing"
                ? 0.65
                : 0.45
          })
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const providerMessage =
        data?.error?.message ||
        `Groq request failed with HTTP ${response.status}.`;

      if (
        response.status ===
        429
      ) {
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
        error:
          providerMessage,

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

    if (!content) {
      return res.status(502).json({
        error:
          finishReason ===
          "length"
            ? "The AI reached its output limit before producing usable text. Try a slightly shorter request."
            : "The AI returned an empty response. Please try again.",

        requestType,

        finishReason,

        retryable: true
      });
    }

    return res.json({
      content,

      model:
        selectedModel,

      mode,

      requestType,

      truncated:
        finishReason ===
        "length",

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
        process.env.NODE_ENV ===
        "production"
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
