/* =========================================================================
   A BYTE-PAIR ENCODING (BPE) TOKENIZER, BUILT FOR LEARNING
   =========================================================================
   The whole pipeline, stage by stage:

     raw text
       -> (1) normalize        : optional cleanup (e.g. lowercasing)
       -> (2) pre-tokenize      : split into "words" so merges can't cross
                                  word boundaries (GPT-2 style regex)
       -> (3) bytes             : every word becomes a list of UTF-8 bytes.
                                  Starting from bytes (0-255) means ANY text
                                  is representable — no "unknown token".
       -> (4) BPE merges        : repeatedly find the most frequent adjacent
                                  pair of symbols and merge it into one new
                                  symbol. Do this N times. THIS is "training".
       -> (5) final tokens      : each remaining symbol maps to an integer id.

   We record the state after every step so the UI can render it.
   ========================================================================= */

/** One unique pre-token ("word") and its current symbol sequence. */
export interface Word {
  /** The original chunk text, e.g. " token". */
  word: string;
  /** How many times this exact chunk appeared in the input. */
  freq: number;
  /** Current symbol sequence — starts as bytes, grows as merges apply. */
  symbols: string[];
}

/** A single learned merge rule plus a snapshot of the world right after it. */
export interface MergeRecord {
  /** 0-based order in which this merge was learned. */
  index: number;
  /** Left symbol of the fused pair. */
  a: string;
  /** Right symbol of the fused pair. */
  b: string;
  /** The new symbol, i.e. a + b. */
  merged: string;
  /** How often this pair occurred when it was chosen. */
  freq: number;
  /** Full state of every word immediately after applying this merge. */
  snapshot: Word[];
}

/** A selectable pre-tokenization scheme (the part that really differs between
 *  real tokenizers). All of them feed the same byte-level BPE below. */
export interface Scheme {
  id: string;
  label: string;
  /** Plain-English note about what makes this scheme distinctive. */
  note: string;
  /** The pre-tokenization regex, as a source string (compiled per call). */
  pattern: string;
}

/**
 * The pre-tokenization regexes used by real tokenizers.
 *
 * GPT-2/3.5/4/4o all use *byte-level BPE* — the only publicly documented thing
 * that differs (besides the trained vocab) is this splitting regex. These are
 * the actual patterns from OpenAI's open-source `tiktoken`, with one mechanical
 * change: `tiktoken` writes case-insensitive contractions as `(?i:'s|'t|...)`,
 * an inline flag group not supported by every JS engine, so we expand them to
 * explicit character classes (e.g. `'[sS]`) — behaviourally identical.
 *
 * Anthropic does not publish Claude's tokenizer regex, so there is deliberately
 * no "Claude" preset here — faking one would be misleading.
 */
export const SCHEMES: Scheme[] = [
  {
    id: "gpt2",
    label: "GPT-2 (r50k_base)",
    note: "The original. A leading space sticks to the following word, and ALL consecutive digits stay in one chunk (\"2024\" is one piece). Contraction suffixes only match lowercase.",
    pattern:
      "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+",
  },
  {
    id: "cl100k",
    label: "GPT-3.5 / GPT-4 (cl100k_base)",
    note: "Groups digits into runs of at most 3 (\"2024\" → \"202\"+\"4\"), matches contractions case-insensitively, and keeps trailing newlines glued to punctuation.",
    pattern:
      "'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+",
  },
  {
    id: "o200k",
    label: "GPT-4o (o200k_base)",
    note: "The newest scheme. Same max-3-digit grouping, plus a more elaborate rule that splits words on case changes — better for camelCase and non-Latin scripts.",
    pattern:
      "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?:'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))?|[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?:'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))?|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+",
  },
];

const DEFAULT_SCHEME = SCHEMES[0];

/** Everything the UI needs to render the pipeline, one field per stage. */
export interface TokenizeResult {
  scheme: Scheme;
  normalized: string;
  chunks: string[];
  initialWords: Word[];
  mergeHistory: MergeRecord[];
  finalTokens: string[];
  /** token symbol -> integer id, in first-seen order. */
  vocab: Map<string, number>;
}

export interface TokenizeOptions {
  lowercase?: boolean;
  numMerges?: number;
  /** Which pre-tokenization scheme to use (see SCHEMES). Defaults to GPT-2. */
  schemeId?: string;
}

// ---- (2) Pre-tokenization -------------------------------------------------
// Split the text into word-like chunks with the chosen scheme's regex. The
// regex is compiled fresh each call so the stateful `g`-flag lastIndex can't
// leak between runs. It keeps a leading space attached to the following word
// (that's why real tokenizers have tokens like " token").
function preTokenize(text: string, pattern: string): string[] {
  const re = new RegExp(pattern, "gu");
  return text.match(re) ?? [];
}

// ---- (3) Bytes ------------------------------------------------------------
// Turn a string into its UTF-8 byte values, then render each byte as a short
// human-readable symbol. Printable ASCII stays as-is; everything else shows
// as ⟨hex⟩ so multi-byte characters (emoji, accents) are visible.
const utf8 = new TextEncoder();

function byteToSymbol(b: number): string {
  if (b === 32) return "·"; // show spaces as a middle dot
  if (b >= 33 && b <= 126) return String.fromCharCode(b); // printable ASCII
  return "⟨" + b.toString(16).padStart(2, "0") + "⟩"; // e.g. ⟨f0⟩
}

function wordToByteSymbols(word: string): string[] {
  return Array.from(utf8.encode(word), byteToSymbol);
}

// ---- (4) BPE core ---------------------------------------------------------
// Count how often each adjacent pair of symbols occurs across all words,
// weighted by how many times each word appears.
function countPairs(words: Word[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { symbols, freq } of words) {
    for (let i = 0; i < symbols.length - 1; i++) {
      const key = symbols[i] + " " + symbols[i + 1];
      counts.set(key, (counts.get(key) ?? 0) + freq);
    }
  }
  return counts;
}

// Find the single most frequent pair. Ties are broken deterministically (by
// lexical order of the pair key) so results are stable across runs.
function bestPair(counts: Map<string, number>): { key: string; n: number } | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && key < best)) {
      best = key;
      bestN = n;
    }
  }
  return best ? { key: best, n: bestN } : null;
}

// Replace every adjacent occurrence of [a, b] with the single symbol a+b
// inside one word's symbol list.
function mergeWord(symbols: string[], a: string, b: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < symbols.length) {
    if (i < symbols.length - 1 && symbols[i] === a && symbols[i + 1] === b) {
      out.push(a + b);
      i += 2;
    } else {
      out.push(symbols[i]);
      i += 1;
    }
  }
  return out;
}

/**
 * Run the whole pipeline, recording a snapshot after each phase so the UI can
 * replay it. `numMerges` controls how many BPE steps we perform.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): TokenizeResult {
  const { lowercase = false, numMerges = 50, schemeId } = options;
  const scheme = SCHEMES.find((s) => s.id === schemeId) ?? DEFAULT_SCHEME;

  // (1) Normalize
  let normalized = text.normalize("NFC");
  if (lowercase) normalized = normalized.toLowerCase();

  // (2) Pre-tokenize
  const chunks = preTokenize(normalized, scheme.pattern);

  // Group identical chunks together with a frequency count. BPE cares about
  // pair *frequencies*, so counting duplicates once (with a weight) is both
  // faster and closer to how real training works.
  const freqMap = new Map<string, number>();
  for (const c of chunks) freqMap.set(c, (freqMap.get(c) ?? 0) + 1);

  // (3) Bytes: seed each unique word with its byte-symbol sequence.
  let words: Word[] = [...freqMap.entries()].map(([word, freq]) => ({
    word,
    freq,
    symbols: wordToByteSymbols(word),
  }));
  // Snapshot the initial (pre-merge) symbol state.
  const initialWords: Word[] = words.map((w) => ({ ...w, symbols: [...w.symbols] }));

  // (4) BPE merges. After each merge we snapshot the learned rule, the
  // frequency it had, and the full state of every word so the UI can scrub.
  const mergeHistory: MergeRecord[] = [];
  for (let step = 0; step < numMerges; step++) {
    const counts = countPairs(words);
    const best = bestPair(counts);
    if (!best || best.n < 2) break; // nothing left worth merging
    const [a, b] = best.key.split(" ");
    words = words.map((w) => ({ ...w, symbols: mergeWord(w.symbols, a, b) }));
    mergeHistory.push({
      index: step,
      a,
      b,
      merged: a + b,
      freq: best.n,
      snapshot: words.map((w) => ({ word: w.word, freq: w.freq, symbols: [...w.symbols] })),
    });
  }

  // (5) Final tokens: expand words back into the original chunk order and
  // assign an integer id to each distinct token symbol.
  const finalByWord = new Map(words.map((w) => [w.word, w.symbols]));
  const finalTokens: string[] = [];
  for (const chunk of chunks) {
    for (const sym of finalByWord.get(chunk) ?? []) finalTokens.push(sym);
  }
  const vocab = new Map<string, number>();
  for (const t of finalTokens) if (!vocab.has(t)) vocab.set(t, vocab.size);

  return { scheme, normalized, chunks, initialWords, mergeHistory, finalTokens, vocab };
}
