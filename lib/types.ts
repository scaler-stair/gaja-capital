// Shapes shared by server pages, API routes and client components.

export type Rating = "High" | "Medium" | "Low";
export type ObsStatus = "awaiting" | "open" | "in_progress" | "closed";
export type ReportStatus = "uploading" | "queued" | "processing" | "ready" | "failed";

export const RATINGS: Rating[] = ["High", "Medium", "Low"];
export const STATUSES: ObsStatus[] = ["awaiting", "open", "in_progress", "closed"];

export const STATUS_LABEL: Record<ObsStatus, string> = {
  awaiting: "Response awaited",
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};

export type SummaryPoint = { heading: string; detail: string };

export type KeyMetric = {
  label: string;
  /** As printed in the report, e.g. "₹11.70 Cr". */
  value: string;
  /** The same figure in rupees, when it is a rupee amount. */
  amount_inr: number | null;
  ref: string | null;
};

export type AreaSummary = {
  name: string;
  scope: string[];
  high: number;
  medium: number;
  low: number;
};

export type WayForwardStep = {
  label: string;
  due_date: string | null;
  due_text: string | null;
  items: Array<{ text: string; refs: string[] }>;
};

export type VarianceItem = {
  label: string;
  previous: number | null;
  current: number | null;
  comment: string | null;
};

export type Variance = {
  title: string;
  unit: string;
  previous_label: string;
  current_label: string;
  items: VarianceItem[];
};

/** A later report's action-taken note on an observation from an earlier report. */
export type PriorUpdate = {
  ref: string;
  title: string;
  previous_report: string | null;
  status: ObsStatus;
  status_text: string | null;
  remarks: string | null;
};

export type ReportOverview = {
  headline: string;
  scope_note: string | null;
  /** Meeting or report date as printed, e.g. "October 2026". */
  date_text: string | null;
  executive_summary: SummaryPoint[];
  key_metrics: KeyMetric[];
  areas: AreaSummary[];
  rating_scale: Array<{ rating: Rating; meaning: string }>;
  way_forward: WayForwardStep[];
  decisions_requested: string[];
  variance: Variance | null;
  prior_updates: PriorUpdate[];
  /** Anything the pipeline could not complete, shown to admins on the report page. */
  warnings: string[];
};

export type ReportRow = {
  id: number;
  file_name: string;
  file_size: number;
  page_count: number | null;
  status: ReportStatus;
  stage: number;
  stage_label: string | null;
  error: string | null;
  title: string | null;
  company: string | null;
  auditor: string | null;
  meeting: string | null;
  report_label: string | null;
  period_label: string | null;
  quarter: string | null;
  fiscal_year: string | null;
  period_start: string | null;
  period_end: string | null;
  report_date: string | null;
  overview: ReportOverview | null;
  created_at: string;
  processed_at: string | null;
  uploaded_by_name: string | null;
  observation_count: number;
  high: number;
  medium: number;
  low: number;
};

export type Observation = {
  id: number;
  report_id: number;
  position: number;
  ref: string;
  title: string;
  area: string;
  rating: Rating;
  status: ObsStatus;
  status_text: string | null;
  owner: string | null;
  owners: string[];
  target_date: string | null;
  target_text: string | null;
  summary: string | null;
  background: string | null;
  exceptions: string[];
  root_causes: string[];
  recommendations: string[];
  management_response: string | null;
  impact_text: string | null;
  impact_inr: number | null;
  evidence: string | null;
  source_page: number | null;
  source_quote: string | null;
};

/** An observation with the report it came from, for cross-report views. */
export type ObservationWithReport = Observation & {
  period: string;
  report_title: string;
};

export type ObservationLink = { earlier_id: number; later_id: number; note: string | null };

export type StatusUpdate = {
  report_id: number;
  observation_id: number;
  status: ObsStatus;
  status_text: string | null;
  remarks: string | null;
};

/** What the chat UI needs to turn [[R12:FR-1]] into a link to the source passage. */
export type Citation = {
  key: string;
  observationId: number;
  reportId: number;
  ref: string;
  title: string;
  rating: Rating;
  period: string;
  reportTitle: string;
  page: number | null;
  quote: string | null;
  searchText: string;
};

/** Minimal report identity used by charts, pickers and citations. */
export type ReportRef = {
  id: number;
  period: string;
  title: string;
  date: string | null;
};
