# Peppermint Markdown Studio V2

A dependency-light, real-time Markdown editor with a document-aware Groq AI assistant.

## Requirements

- Node.js 18+
- A Groq API key

## Setup

1. Copy `.env.example` to `.env`.
2. Put your Groq key in `GROQ_API_KEY`.
3. Run:

```bash
npm install
npm start
```

4. Open:

```text
http://localhost:3000
```

The API key is kept on the server and is never placed in the browser code.

## AI features

- Ask AI about the current document
- Rewrite selected text
- Improve writing
- Fix grammar
- Shorten
- Expand
- Continue writing
- Summarize
- Explain
- Fix Markdown
- Generate Markdown from instructions
- Accept/reject proposed Markdown edits
- Copy AI output
- Document-aware context
- Selection-aware context
- Conversation history for the current session

## Markdown features

- H1-H6
- Bold
- Italic
- Strikethrough
- Inline code
- Fenced code blocks
- Ordered and unordered lists
- Task lists
- Blockquotes
- Links
- Images
- Tables
- Horizontal rules
- Live preview
- Word/character/line count
- Local autosave
- Undo/redo
- Markdown download
- Copy Markdown
- Copy rendered text
- Tab indentation

## Security note

Do not put your Groq API key into `public/index.html`.
Keep it in `.env`, which should not be committed to a public repository.


## V3 workspace modes

Simple Markdown uses portable Markdown formatting. HTML Markdown keeps all Markdown formatting and adds controlled HTML text styling. The formatting toolbar is horizontally scrollable and changes with the active mode.

The AI receives the active editor mode and is instructed to reason about formatting intent. In Simple Markdown, HTML-only visual formatting requests are blocked with the exact guidance: `Please change to HTML Markdown editor to use this feature.`
