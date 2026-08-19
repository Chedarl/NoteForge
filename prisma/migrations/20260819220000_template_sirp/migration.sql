-- Adds SIRP (Situation, Intervention, Response, Plan) to TemplateKind.
--
-- Additive and idempotent. A new enum value cannot invalidate an existing row,
-- so this applies cleanly to a database serving older code — which matters
-- because migrations run on deploy, ahead of the code that uses the value.
ALTER TYPE "TemplateKind" ADD VALUE IF NOT EXISTS 'SIRP';
