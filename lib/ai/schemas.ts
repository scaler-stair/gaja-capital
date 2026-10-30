// Structured-output schemas for Claude. Unknown text is "" and unknown numbers are 0
// rather than null: fewer nullable unions keeps the schema simple for constrained
// decoding, and lib/pipeline.ts turns the blanks back into nulls before saving.
import { z } from "zod";

export const RatingEnum = z.enum(["High", "Medium", "Low"]);
export const StatusEnum = z.enum(["awaiting", "open", "in_progress", "closed"]);

const IndexItem = z.object({
  ref: z.string().describe("The report's own reference code, e.g. FR-1"),
  title: z.string(),
  area: z.string().describe("Full name of the area of review"),
  rating: RatingEnum,
  status: StatusEnum,
  status_text: z.string().describe("Status as printed, e.g. 'Response awaited'"),
  owner: z.string().describe("Owner as printed"),
  owners: z.array(z.string()).describe("Each accountable role separately, full consistent names"),
  target_date: z.string().describe("YYYY-MM-DD, or empty"),
  target_text: z.string().describe("Target date as printed"),
  evidence: z.string().describe("Source or annexure reference, e.g. 'Annex 11'"),
  source_page: z.number().int().describe("1-based PDF page of the detailed write-up"),
});

// The overview is read in two passes: one schema for both would compile to a
// constrained-decoding grammar larger than the API accepts.
export const IndexExtraction = z.object({
  title: z.string(),
  company: z.string(),
  auditor: z.string(),
  meeting: z.string().describe("Forum the report is presented to, e.g. 'Audit Committee'"),
  report_label: z.string().describe("e.g. 'Internal Audit Report I'"),
  period_label: z.string().describe("As printed, e.g. 'Q2 FY 2026-27'"),
  quarter: z.string().describe("Q1, Q2, Q3, Q4 or empty"),
  fiscal_year: z.string().describe("e.g. 'FY 2026-27'"),
  period_start: z.string().describe("YYYY-MM-DD or empty"),
  period_end: z.string().describe("YYYY-MM-DD or empty"),
  report_date: z.string().describe("YYYY-MM-DD when a full date is printed, else empty"),
  report_date_text: z.string().describe("Meeting or report date as printed, e.g. 'October 2026'"),
  observations: z.array(IndexItem),
});

export const NarrativeExtraction = z.object({
  headline: z.string(),
  scope_note: z.string(),
  executive_summary: z.array(z.object({ heading: z.string(), detail: z.string() })),
  key_metrics: z.array(
    z.object({
      label: z.string(),
      value: z.string().describe("As printed, e.g. '₹11.70 Cr'"),
      amount_inr: z.number().describe("Rupee value as a plain number, or 0"),
      ref: z.string().describe("Related observation ref, or empty"),
    })
  ),
  areas: z.array(
    z.object({
      name: z.string(),
      scope: z.array(z.string()),
      high: z.number().int(),
      medium: z.number().int(),
      low: z.number().int(),
    })
  ),
  rating_scale: z.array(z.object({ rating: RatingEnum, meaning: z.string() })),
  way_forward: z.array(
    z.object({
      label: z.string(),
      due_date: z.string().describe("YYYY-MM-DD or empty"),
      due_text: z.string(),
      items: z.array(z.object({ text: z.string(), refs: z.array(z.string()) })),
    })
  ),
  decisions_requested: z.array(z.string()),
  variance: z.object({
    title: z.string(),
    unit: z.string().describe("e.g. '₹ lakh'"),
    previous_label: z.string().describe("e.g. 'Q1'"),
    current_label: z.string().describe("e.g. 'Q2'"),
    items: z.array(
      z.object({ label: z.string(), previous: z.number(), current: z.number(), comment: z.string() })
    ),
  }),
  prior_updates: z.array(
    z.object({
      ref: z.string(),
      title: z.string(),
      previous_report: z.string(),
      status: StatusEnum,
      status_text: z.string(),
      remarks: z.string(),
    })
  ),

});

export type IndexResult = z.infer<typeof IndexExtraction>;
export type NarrativeOutput = z.infer<typeof NarrativeExtraction>;
/** Both reading passes over the report, combined. */
export type OverviewOutput = IndexResult & NarrativeOutput;
export type IndexOutput = IndexResult["observations"][number];

/** Used when the narrative pass fails: the report still publishes with its observations. */
export const EMPTY_NARRATIVE: NarrativeOutput = {
  headline: "",
  scope_note: "",
  executive_summary: [],
  key_metrics: [],
  areas: [],
  rating_scale: [],
  way_forward: [],
  decisions_requested: [],
  variance: { title: "", unit: "", previous_label: "", current_label: "", items: [] },
  prior_updates: [],
};

export const DetailsExtraction = z.object({
  observations: z.array(
    z.object({
      ref: z.string(),
      summary: z.string(),
      background: z.string(),
      exceptions: z.array(z.string()),
      root_causes: z.array(z.string()),
      recommendations: z.array(z.string()),
      management_response: z.string(),
      impact_text: z.string(),
      impact_inr: z.number(),
      source_page: z.number().int(),
      source_quote: z.string(),
    })
  ),
});

export type DetailOutput = z.infer<typeof DetailsExtraction>["observations"][number];

export const MatchExtraction = z.object({
  repeats: z.array(z.object({ later_ref: z.string(), earlier_key: z.string(), note: z.string() })),
  updates: z.array(
    z.object({ earlier_key: z.string(), status: StatusEnum, status_text: z.string(), remarks: z.string() })
  ),
});

export type MatchOutput = z.infer<typeof MatchExtraction>;
