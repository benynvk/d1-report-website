-- Whether a member is a developer or a tester: decides the filler task
-- auto-WIP adds when every ordering of their tasks was already used
-- ("Review code" for dev, "Smoke test" for tester).
ALTER TABLE d1_report.members
  ADD COLUMN IF NOT EXISTS "position" varchar NOT NULL DEFAULT 'dev';
