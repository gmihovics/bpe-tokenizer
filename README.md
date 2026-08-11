# 🔤 BPE Tokenizer Playground

A single-page app that tokenizes text the way modern language models do — with
**Byte-Pair Encoding (BPE)** — and explains every stage of the pipeline as it
goes, showing the data at each step. The BPE vocabulary is *trained live on your
input*, so you can watch merges happen one at a time.

## The pipeline it visualizes

1. **Normalize** — Unicode NFC (+ optional lowercasing).
2. **Pre-tokenize** — split into word-like chunks with a selectable
   [scheme](#pre-tokenization-schemes) so merges can't cross word boundaries.
3. **Encode to bytes** — every chunk becomes its raw UTF-8 bytes. Starting from
   bytes means no character is ever "unknown".
4. **Learn BPE merges** — repeatedly fuse the most frequent adjacent pair of
   symbols. An interactive scrubber starts before the first merge so you can
   step forward through each one.
5. **Final tokens & ids** — remaining symbols become tokens, each mapped to an
   integer id, plus compression stats.

## Pre-tokenization schemes

GPT-2, GPT-4, and GPT-4o all use the **same** byte-level BPE algorithm. The
publicly documented thing that differs (besides the trained vocabulary) is the
*pre-tokenization regex* — the rule for splitting text into chunks before
merging — which genuinely changes where token boundaries land. The dropdown lets
you swap between them, using the real patterns from OpenAI's open-source
[`tiktoken`](https://github.com/openai/tiktoken):

- **GPT-2 (r50k_base)** — all consecutive digits stay in one chunk; contraction
  suffixes match lowercase only.
- **GPT-3.5 / GPT-4 (cl100k_base)** — groups digits in runs of at most 3
  (`2024` → `202` + `4`), case-insensitive contractions.
- **GPT-4o (o200k_base)** — same digit grouping plus a more elaborate rule that
  splits words on case changes (better for camelCase and non-Latin scripts).

There is intentionally **no Claude preset**: Anthropic doesn't publish Claude's
tokenizer regex the way OpenAI does, so a faithful version isn't possible and a
fake one would be misleading.

## Run it

```bash
npm install     # one-time: installs TypeScript
npm run build   # compile src/*.ts -> dist/*.js
npm run serve   # serve on http://localhost:8000  (ES modules need HTTP, not file://)
```

Then open http://localhost:8000.

While developing, run the compiler in watch mode in a second terminal:

```bash
npm run watch
```

## Where the code lives

- `src/tokenizer.ts` — the pure, fully-typed BPE implementation. Start here to
  learn the algorithm; it's heavily commented.
- `src/app.ts` — the DOM rendering layer (turns each recorded step into a card).
- `index.html` — markup + styles, loads the compiled `dist/app.js`.

## How this differs from a real tokenizer

Real tokenizers (GPT, Claude, etc.) use the *same* BPE algorithm but with a
**fixed** vocabulary of ~100k merges trained once on a huge corpus — they don't
retrain per input. This app retrains on whatever you type so the merge steps are
visible and meaningful on short text.
