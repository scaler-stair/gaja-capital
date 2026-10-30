import "server-only";
import { aiConfigured, anthropic, EXTRACTION_EFFORT, FALLBACK, MODEL } from "./client";
import { addUsage, jsonFormat, refKey, type Usage } from "./extract";
import { MATCH_SYSTEM, matchInstruction } from "./prompts";
import { MatchExtraction, type MatchOutput } from "./schemas";
import type { ObsStatus, PriorUpdate, Rating } from "../types";

export type EarlierIssue = {
  key: string;
  period: string;
  ref: string;
  title: string;
  area: string;
  rating: Rating;
  status: ObsStatus;
  summary: string | null;
  /** Earlier appearances of the same issue, e.g. "FR-1 in Q1 FY27". */
  history: string[];
};

export type LaterObservation = { ref: string; title: string; area: string; rating: Rating; summary: string | null };

export type MatchInput = {
  earlier: EarlierIssue[];
  later: { period: string; observations: LaterObservation[]; priorUpdates: PriorUpdate[] };
};

function payloadText(input: MatchInput): string {
  const earlier = input.earlier
    .map(
      (e) =>
        `- key ${e.key} | ${e.period} ${e.ref} | ${e.rating} | ${e.status} | ${e.area} | ${e.title}` +
        (e.summary ? ` | ${e.summary}` : "") +
        (e.history.length > 0 ? ` | earlier: ${e.history.join("; ")}` : "")
    )
    .join("\n");
  const later = input.later.observations
    .map((o) => `- ${o.ref} | ${o.rating} | ${o.area} | ${o.title}` + (o.summary ? ` | ${o.summary}` : ""))
    .join("\n");
  const updates = input.later.priorUpdates
    .map(
      (u) =>
        `- ${u.ref} | ${u.title}` +
        (u.previous_report ? ` | from ${u.previous_report}` : "") +
        ` | ${u.status_text || u.status}` +
        (u.remarks ? ` | ${u.remarks}` : "")
    )
    .join("\n");
  return `EARLIER ISSUES
${earlier || "(none)"}

NEWER REPORT (${input.later.period}): OBSERVATIONS
${later || "(none)"}

NEWER REPORT: STATUS OF EARLIER OBSERVATIONS
${updates || "(none given)"}`;
}

/**
 * Links a newer report's observations to earlier issues. Claude does the matching;
 * when it is unavailable or fails, word overlap and refs do a cautious version.
 * Either way the result is validated, so no link can point at an unknown key.
 */
export async function matchAgainstEarlier(input: MatchInput, usage: Usage): Promise<{ result: MatchOutput; method: "ai" | "text" }> {
  if (input.earlier.length === 0) return { result: { repeats: [], updates: [] }, method: "text" };
  if (aiConfigured()) {
    try {
      const { format, parse } = jsonFormat(MatchExtraction);
      const stream = anthropic().beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: EXTRACTION_EFFORT, format },
        system: MATCH_SYSTEM,
        messages: [{ role: "user", content: matchInstruction(payloadText(input)) }],
      });
      const message = await stream.finalMessage();
      addUsage(usage, message.usage);
      return { result: validate(parse(message), input), method: "ai" };
    } catch (err) {
      console.error("AI matching failed, falling back to text similarity:", err);
    }
  }
  return { result: validate(textMatch(input), input), method: "text" };
}

function validate(raw: MatchOutput, input: MatchInput): MatchOutput {
  const keys = new Set(input.earlier.map((e) => e.key));
  const laterRefs = new Map(input.later.observations.map((o) => [refKey(o.ref), o.ref]));
  const usedEarlier = new Set<string>();
  const usedLater = new Set<string>();
  const repeats: MatchOutput["repeats"] = [];
  for (const r of raw.repeats) {
    const later = laterRefs.get(refKey(r.later_ref));
    if (!later || !keys.has(r.earlier_key) || usedEarlier.has(r.earlier_key) || usedLater.has(later)) continue;
    usedEarlier.add(r.earlier_key);
    usedLater.add(later);
    repeats.push({ later_ref: later, earlier_key: r.earlier_key, note: r.note });
  }
  const updated = new Set<string>();
  const updates = raw.updates.filter((u) => {
    if (!keys.has(u.earlier_key) || updated.has(u.earlier_key)) return false;
    updated.add(u.earlier_key);
    return true;
  });
  return { repeats, updates };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const REPEAT_THRESHOLD = 0.45;
const UPDATE_TITLE_THRESHOLD = 0.3;

function textMatch(input: MatchInput): MatchOutput {
  const earlierWords = input.earlier.map((e) => words(`${e.title} ${e.summary ?? ""}`));
  const taken = new Set<number>();
  const repeats: MatchOutput["repeats"] = [];
  for (const o of input.later.observations) {
    const w = words(`${o.title} ${o.summary ?? ""}`);
    let best = -1;
    let bestScore = 0;
    earlierWords.forEach((ew, i) => {
      if (taken.has(i)) return;
      const score = jaccard(w, ew);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= REPEAT_THRESHOLD) {
      taken.add(best);
      repeats.push({ later_ref: o.ref, earlier_key: input.earlier[best].key, note: "Similar wording" });
    }
  }
  const updates: MatchOutput["updates"] = [];
  for (const u of input.later.priorUpdates) {
    const candidates = input.earlier
      .filter((e) => refKey(e.ref) === refKey(u.ref))
      .filter((e) => jaccard(words(e.title), words(u.title)) >= UPDATE_TITLE_THRESHOLD || !u.title);
    const target = candidates.at(-1);
    if (target) {
      updates.push({ earlier_key: target.key, status: u.status, status_text: u.status_text ?? "", remarks: u.remarks ?? "" });
    }
  }
  return { repeats, updates };
}
