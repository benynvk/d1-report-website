-- Optional % complete for a task left "In progress" that day (0-99);
-- shown as "In progress (40%)" in the daily reports.
ALTER TABLE d1_report.report_entries
  ADD COLUMN IF NOT EXISTS "progress" integer;
