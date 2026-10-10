# Domain docs

## Layout

Single-context repository:

- `CONTEXT.md`: existing product context and domain terminology.
- `docs/adr/`: architectural decision records, created when decisions warrant them.

No context map or per-package context split is required.

## Before exploring

1. Read `AGENTS.md` and root `CONTEXT.md`.
2. Read `docs/database-contract.md`; follow the topic-specific reading order
   in `CONTEXT.md`.
3. Read ADRs in `docs/adr/` that concern the work, when that directory exists.

If optional ADR files are absent, proceed silently. The `domain-modeling`
skill creates them lazily when terms or decisions are resolved. Existing
required project documents remain mandatory.

## Vocabulary and authority

Use domain terms as defined in `CONTEXT.md` and the relevant contracts when
writing tickets, hypotheses, proposals and tests. Reconsider invented synonyms;
note genuine terminology gaps for `domain-modeling`.

Migration SQL in `supabase/migrations/` remains the physical schema authority.
This configuration changes no product scope or database contract.

## Decision conflicts

Surface conflicts with an existing ADR explicitly, naming its identifier and
why it may need reopening. Follow `AGENTS.md` for approved contract changes.
