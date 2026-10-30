import { authorize } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { allObservations } from "@/lib/data";
import { formatDate, isOverdue, todayIso } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/types";

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Quote everything, and neutralise leading characters spreadsheets treat as formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The observation register as CSV for Excel, optionally for one report (?report=ID). */
export async function GET(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const reportParam = Number(new URL(req.url).searchParams.get("report"));
  const today = todayIso();
  const rows = (await allObservations()).filter((o) => !reportParam || o.report_id === reportParam);
  const header = [
    "Report", "Ref", "Observation", "Area", "Rating", "Status", "Overdue", "Owner", "Target date",
    "Summary", "Root cause", "Recommendation", "Management response", "Impact", "Source page",
  ];
  const lines = rows.map((o) =>
    [
      o.period, o.ref, o.title, o.area, o.rating, o.status_text ?? STATUS_LABEL[o.status],
      isOverdue(o, today) ? "Yes" : "No", o.owner, o.target_date ? formatDate(o.target_date) : o.target_text,
      o.summary, o.root_causes.join("; "), o.recommendations.join("; "), o.management_response,
      o.impact_text, o.source_page,
    ]
      .map(cell)
      .join(",")
  );
  await logActivity(auth.user.id, "Exported observations", reportParam ? `Report ${reportParam}` : "All reports");
  const csv = "﻿" + [header.map(cell).join(","), ...lines].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gaja-capital-observations-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
