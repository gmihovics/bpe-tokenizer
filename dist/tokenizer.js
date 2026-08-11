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
// ---- (2) Pre-tokenization -------------------------------------------------
// A simplified version of GPT-2's regex. It keeps a leading space attached to
// the following word (that's why real tokenizers have tokens like " token").
// It splits contractions, letters, numbers, punctuation, and whitespace runs.
const PRE_TOKEN_RE = /'s|'t|'re|'ve|'m|'ll|'d| ?[\p{L}]+| ?[\p{N}]+| ?[^\s\p{L}\p{N}]+|\s+/gu;
function preTokenize(text) {
    return text.match(PRE_TOKEN_RE) ?? [];
}
// ---- (3) Bytes ------------------------------------------------------------
// Turn a string into its UTF-8 byte values, then render each byte as a short
// human-readable symbol. Printable ASCII stays as-is; everything else shows
// as ⟨hex⟩ so multi-byte characters (emoji, accents) are visible.
const utf8 = new TextEncoder();
function byteToSymbol(b) {
    if (b === 32)
        return "·"; // show spaces as a middle dot
    if (b >= 33 && b <= 126)
        return String.fromCharCode(b); // printable ASCII
    return "⟨" + b.toString(16).padStart(2, "0") + "⟩"; // e.g. ⟨f0⟩
}
function wordToByteSymbols(word) {
    return Array.from(utf8.encode(word), byteToSymbol);
}
// ---- (4) BPE core ---------------------------------------------------------
// Count how often each adjacent pair of symbols occurs across all words,
// weighted by how many times each word appears.
function countPairs(words) {
    const counts = new Map();
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
function bestPair(counts) {
    let best = null;
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
function mergeWord(symbols, a, b) {
    const out = [];
    let i = 0;
    while (i < symbols.length) {
        if (i < symbols.length - 1 && symbols[i] === a && symbols[i + 1] === b) {
            out.push(a + b);
            i += 2;
        }
        else {
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
export function tokenize(text, options = {}) {
    const { lowercase = false, numMerges = 50 } = options;
    // (1) Normalize
    let normalized = text.normalize("NFC");
    if (lowercase)
        normalized = normalized.toLowerCase();
    // (2) Pre-tokenize
    const chunks = preTokenize(normalized);
    // Group identical chunks together with a frequency count. BPE cares about
    // pair *frequencies*, so counting duplicates once (with a weight) is both
    // faster and closer to how real training works.
    const freqMap = new Map();
    for (const c of chunks)
        freqMap.set(c, (freqMap.get(c) ?? 0) + 1);
    // (3) Bytes: seed each unique word with its byte-symbol sequence.
    let words = [...freqMap.entries()].map(([word, freq]) => ({
        word,
        freq,
        symbols: wordToByteSymbols(word),
    }));
    // Snapshot the initial (pre-merge) symbol state.
    const initialWords = words.map((w) => ({ ...w, symbols: [...w.symbols] }));
    // (4) BPE merges. After each merge we snapshot the learned rule, the
    // frequency it had, and the full state of every word so the UI can scrub.
    const mergeHistory = [];
    for (let step = 0; step < numMerges; step++) {
        const counts = countPairs(words);
        const best = bestPair(counts);
        if (!best || best.n < 2)
            break; // nothing left worth merging
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
    const finalTokens = [];
    for (const chunk of chunks) {
        for (const sym of finalByWord.get(chunk) ?? [])
            finalTokens.push(sym);
    }
    const vocab = new Map();
    for (const t of finalTokens)
        if (!vocab.has(t))
            vocab.set(t, vocab.size);
    return { normalized, chunks, initialWords, mergeHistory, finalTokens, vocab };
}
//# sourceMappingURL=tokenizer.js.map