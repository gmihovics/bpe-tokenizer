# 🔤 BPE Tokenizer Playground

A single-page app that tokenizes text the way modern language models do — with
**Byte-Pair Encoding (BPE)** — and explains every stage of the pipeline as it
goes, showing the data at each step. The BPE vocabulary is *trained live on your
input*, so you can watch merges happen one at a time.

## The pipeline it visualizes

1. **Normalize** — Unicode NFC (+ optional lowercasing).
2. **Pre-tokenize** — split into word-like chunks (GPT-2-style regex) so merges
   can't cross word boundaries.
3. **Encode to bytes** — every chunk becomes its raw UTF-8 bytes. Starting from
   bytes means no character is ever "unknown".
4. **Learn BPE merges** — repeatedly fuse the most frequent adjacent pair of
   symbols. Interactive scrubber lets you step through each merge.
5. **Final tokens & ids** — remaining symbols become tokens, each mapped to an
   integer id, plus compression stats.

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
