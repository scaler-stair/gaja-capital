/**
 * Locating an observation's source passage inside its PDF.
 *
 * The model's quote is meant to be verbatim, but PDFs reflow text, hyphenate
 * across lines and use typographic punctuation, and the model's page number is
 * a hint rather than a fact. So matching is layered: exact quote first, then the
 * longest verbatim fragment of it, then a best-page guess from distinctive
 * tokens. Whatever we find, we tell the UI how confident it is.
 */

export type PageText = { pageNumber: number; text: string };

export type QuoteMatch = {
  pageNumber: number;
  /** Character range inside that page's normalized text. Empty for "page" matches. */
  start: number;
  end: number;
  /** exact = whole quote found, partial = longest fragment, page = page guess only. */
  kind: "exact" | "partial" | "page";
};

/**
 * Lowercases, folds typographic punctuation to ASCII, drops zero-width and soft
 * hyphens, and collapses every whitespace run to one space, so that text laid
 * out across PDF lines and columns compares as a single stream.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[­​-‍﻿]/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[  -   　]/g, " ")
    .replace(/…/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Words worth scoring on: numbers and longer words, minus common filler. */
const STOP = new Set([
  "the", "and", "for", "was", "were", "has", "have", "had", "that", "this", "with", "from",
  "not", "are", "its", "their", "which", "been", "into", "should", "would", "will", "may",
  "management", "observation", "recommendation", "report", "audit", "internal",
]);

function distinctiveTokens(normalized: string): string[] {
  const seen = new Set<string>();
  for (const raw of normalized.split(" ")) {
    const token = raw.replace(/^[^a-z0-9.]+|[^a-z0-9.]+$/g, "");
    if (token.length < 4) continue;
    if (STOP.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/** Share of the query's distinctive tokens that appear on the page (0-1). */
function pageScore(pageText: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) if (pageText.includes(t)) hits++;
  return hits / tokens.length;
}

function orderPages(pages: PageText[], hintPage?: number | null): PageText[] {
  if (!hintPage) return pages;
  const hinted = pages.filter((p) => p.pageNumber === hintPage);
  if (hinted.length === 0) return pages;
  return [...hinted, ...pages.filter((p) => p.pageNumber !== hintPage)];
}

const MIN_EXACT_CHARS = 12;
const MIN_WINDOW_TOKENS = 4;
const MAX_WINDOW_TOKENS = 40;
/** Only the strongest few pages get the expensive fragment search. */
const CANDIDATE_PAGES = 4;

/**
 * Finds where `quote` sits in `pages`. `hintPage` (the model's page number) only
 * breaks ties: a verbatim hit on another page always beats the hint.
 */
export function findQuote(
  pages: PageText[],
  quote: string,
  hintPage?: number | null
): QuoteMatch | null {
  const q = normalizeText(quote ?? "");
  if (!q || pages.length === 0) return null;

  const ordered = orderPages(pages, hintPage);

  if (q.length >= MIN_EXACT_CHARS) {
    for (const page of ordered) {
      const at = page.text.indexOf(q);
      if (at !== -1) return { pageNumber: page.pageNumber, start: at, end: at + q.length, kind: "exact" };
    }
  }

  const tokens = q.split(" ").filter(Boolean);
  const distinctive = distinctiveTokens(q);

  // Rank pages, then hunt for the longest verbatim fragment on the best few.
  const ranked = [...pages]
    .map((page) => ({ page, score: pageScore(page.text, distinctive) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.page.pageNumber === hintPage) return -1;
      if (b.page.pageNumber === hintPage) return 1;
      return a.page.pageNumber - b.page.pageNumber;
    });
  const candidates = orderPages(
    ranked.filter((r) => r.score > 0).slice(0, CANDIDATE_PAGES).map((r) => r.page),
    hintPage
  );

  const maxWindow = Math.min(tokens.length, MAX_WINDOW_TOKENS);
  for (let size = maxWindow; size >= MIN_WINDOW_TOKENS; size--) {
    for (let offset = 0; offset + size <= tokens.length; offset++) {
      const fragment = tokens.slice(offset, offset + size).join(" ");
      if (fragment.length < MIN_EXACT_CHARS) continue;
      for (const page of candidates) {
        const at = page.text.indexOf(fragment);
        if (at !== -1) {
          return { pageNumber: page.pageNumber, start: at, end: at + fragment.length, kind: "partial" };
        }
      }
    }
  }

  const best = ranked[0];
  if (best && best.score >= 0.4) {
    return { pageNumber: best.page.pageNumber, start: 0, end: 0, kind: "page" };
  }
  if (hintPage && pages.some((p) => p.pageNumber === hintPage)) {
    return { pageNumber: hintPage, start: 0, end: 0, kind: "page" };
  }
  return null;
}

/**
 * The text we search with. The model's quote when we have one, otherwise the
 * observation's own wording, which still carries the verbatim figures and names
 * that make a passage findable.
 */
export function searchTextFor(o: {
  source_quote?: string | null;
  description?: string | null;
  title: string;
}): string {
  const quote = (o.source_quote ?? "").trim();
  if (quote.length >= 25) return quote;
  const description = (o.description ?? "").trim();
  return description.length >= 25 ? description : o.title;
}
