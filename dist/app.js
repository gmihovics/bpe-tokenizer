/* =========================================================================
   RENDERING — turn each recorded step into an explained UI card, and wire
   up the page controls. All the tokenization logic lives in tokenizer.ts;
   this file only deals with the DOM.
   ========================================================================= */
import { tokenize } from "./tokenizer.js";
const PALETTE = [
    "#1f6feb", "#238636", "#8957e5", "#bb8009",
    "#c9510c", "#1f6f8b", "#a5334f", "#57606a",
];
const colorFor = (i) => PALETTE[i % PALETTE.length] + "44";
const borderFor = (i) => PALETTE[i % PALETTE.length];
/** Make invisible / structural characters visible in rendered pills. */
function visible(s) {
    return s.replace(/ /g, "·").replace(/\n/g, "⏎\n").replace(/\t/g, "⇥");
}
/** Escape HTML-significant characters so token text renders literally. */
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Typed helper for grabbing a required element by id. */
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing element #${id}`);
    return node;
}
function stepShell(num, title, desc, bodyHtml) {
    return `
    <div class="step">
      <div class="step-num">${num}</div>
      <h3>${title}</h3>
      <p class="desc">${desc}</p>
      <div class="step-body">${bodyHtml}</div>
    </div>`;
}
/** Render a set of words as rows of symbol cells (used by steps 3 and 4). */
function renderSymbols(words) {
    const groups = words
        .map((w) => {
        const cells = w.symbols
            .map((s) => {
            // A symbol longer than one "atom" is the product of ≥1 merge.
            const isMerged = s.length > (s.startsWith("⟨") ? 4 : 1);
            return `<span class="sym${isMerged ? " merged" : ""}">${esc(s)}</span>`;
        })
            .join("");
        const count = w.freq > 1 ? " ×" + w.freq : "";
        return `<div class="word-group">
        <span class="word-label">${esc(visible(w.word))}${count}</span>
        <div class="sym-row">${cells}</div>
      </div>`;
    })
        .join("");
    return `<div class="symbols">${groups}</div>`;
}
function render(steps) {
    const out = el("output");
    // Step 1: Normalize
    const normLen = [...steps.normalized].length;
    const normBody = `
    <div class="pills"><span class="pill plain">${esc(visible(steps.normalized)) || "<em>(empty)</em>"}</span></div>
    <p class="hint">Spaces shown as · — length: ${normLen} characters</p>`;
    // Step 2: Pre-tokenize
    const chunkBody = steps.chunks.length
        ? `<div class="pills">${steps.chunks
            .map((c, i) => `<span class="pill" style="background:${colorFor(i)};border-color:${borderFor(i)}">${esc(visible(c))}</span>`)
            .join("")}</div>
      <p class="hint">${steps.chunks.length} chunks — notice leading spaces stay glued to the next word.</p>`
        : `<p class="empty-note">No chunks — the input is empty.</p>`;
    // Step 3: Bytes
    const byteBody = steps.initialWords.length
        ? renderSymbols(steps.initialWords) +
            `<p class="hint">Every word starts as raw UTF-8 bytes. ⟨hex⟩ = a non-ASCII byte. Starting from bytes means <b>no character is ever "unknown".</b></p>`
        : `<p class="empty-note">Nothing to encode.</p>`;
    // Step 4: BPE merges (interactive scrubber)
    const history = steps.mergeHistory;
    const mergeBody = history.length === 0
        ? `<p class="empty-note">No merges happened — either merges were set to 0, or no adjacent pair repeated often enough (needs to appear ≥ 2 times). Try longer / more repetitive text.</p>`
        : `
        <div class="merge-controls">
          <button class="secondary" id="mPrev">‹ Prev</button>
          <input type="range" id="mSlider" min="0" max="${history.length}" value="${history.length}" />
          <button class="secondary" id="mNext">Next ›</button>
        </div>
        <div class="merge-info" id="mInfo"></div>
        <div id="mState" style="margin-top:12px"></div>
        <p class="hint" style="margin-top:12px">Drag the slider (or use Prev/Next) to watch each merge. Merged symbols are highlighted in blue.</p>`;
    // Step 5: Final tokens
    const tokens = steps.finalTokens;
    const vocab = steps.vocab;
    let tokenBody;
    if (tokens.length === 0) {
        tokenBody = `<p class="empty-note">No tokens.</p>`;
    }
    else {
        const chars = normLen;
        const ratio = chars > 0 ? (chars / tokens.length).toFixed(2) : "0";
        const pills = tokens
            .map((t) => {
            const id = vocab.get(t);
            return `<span class="pill" style="background:${colorFor(id)};border-color:${borderFor(id)}" title="id ${id}">${esc(visible(t))}</span>`;
        })
            .join("");
        const ids = tokens.map((t) => `<span class="byte">${vocab.get(t)}</span>`).join("");
        tokenBody = `
      <div class="pills">${pills}</div>
      <div class="stats" style="margin-top:16px">
        <div class="stat"><div class="n">${tokens.length}</div><div class="l">tokens</div></div>
        <div class="stat"><div class="n">${chars}</div><div class="l">characters</div></div>
        <div class="stat"><div class="n">${vocab.size}</div><div class="l">unique tokens</div></div>
        <div class="stat"><div class="n">${ratio}</div><div class="l">chars / token</div></div>
      </div>
      <p class="hint" style="margin-top:12px">Each token maps to an integer id — that's what the model actually reads. Token ids for this text:</p>
      <div class="pills mono">${ids}</div>`;
    }
    out.innerHTML =
        stepShell(1, "Normalize", "Clean up the raw text. Here we apply Unicode NFC normalization (and optional lowercasing). Real tokenizers keep this minimal so information isn't lost.", normBody) +
            stepShell(2, "Pre-tokenize", "Split the text into word-like chunks using a regex. Merges are only allowed <i>within</i> a chunk, so a token can never span across, say, a word and the punctuation after it.", chunkBody) +
            stepShell(3, "Encode to bytes", "Break every chunk into individual UTF-8 bytes. These 256 possible bytes are the starting alphabet of the vocabulary.", byteBody) +
            stepShell(4, "Learn BPE merges", "Repeatedly find the <b>most frequent adjacent pair</b> of symbols and fuse it into one new symbol. Common sequences like <code>·t → ·th</code> get their own tokens. This is exactly how a BPE vocabulary is trained.", mergeBody) +
            stepShell(5, "Final tokens & ids", "After all merges, whatever symbols remain are the tokens. Each distinct token gets an integer id — the numbers fed into the model.", tokenBody);
    if (history.length > 0)
        wireScrubber(history, steps.initialWords);
}
/** Wire up the interactive merge scrubber for step 4. */
function wireScrubber(history, initialWords) {
    const slider = el("mSlider");
    const info = el("mInfo");
    const state = el("mState");
    const prev = el("mPrev");
    const next = el("mNext");
    // k = number of merges applied (0 .. history.length)
    function draw(k) {
        if (k === 0) {
            info.innerHTML = `<span class="merge-badge">start</span> No merges applied yet — pure bytes.`;
            state.innerHTML = renderSymbols(initialWords);
        }
        else {
            const h = history[k - 1];
            info.innerHTML =
                `Merge #${k}: fuse <b>${esc(visible(h.a))}</b> + <b>${esc(visible(h.b))}</b> → ` +
                    `<span class="merge-badge">${esc(visible(h.merged))}</span> &nbsp; (this pair appeared <b>${h.freq}</b> times)`;
            state.innerHTML = renderSymbols(h.snapshot);
        }
        slider.value = String(k);
        prev.disabled = k === 0;
        next.disabled = k === history.length;
    }
    slider.addEventListener("input", () => draw(parseInt(slider.value, 10)));
    prev.addEventListener("click", () => draw(Math.max(0, parseInt(slider.value, 10) - 1)));
    next.addEventListener("click", () => draw(Math.min(history.length, parseInt(slider.value, 10) + 1)));
    draw(history.length); // start showing the fully-merged state
}
/* ---- Wire up the page ---------------------------------------------------- */
function run() {
    const text = el("input").value;
    const numMerges = parseInt(el("merges").value, 10);
    const lowercase = el("lower").checked;
    render(tokenize(text, { lowercase, numMerges }));
}
el("merges").addEventListener("input", () => {
    el("mergesVal").textContent = el("merges").value;
});
el("run").addEventListener("click", run);
el("input").addEventListener("keydown", (e) => {
    const ke = e;
    if ((ke.metaKey || ke.ctrlKey) && ke.key === "Enter")
        run();
});
// Run once on load with the default sample.
run();
//# sourceMappingURL=app.js.map