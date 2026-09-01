# Adding and maintaining flows

The code catalog owns stable flow identity and initial defaults. MongoDB owns
published versions, prompts, allowed tools, transitions and assignments.

## Add a built-in flow

1. Add one entry to `flowCatalog` in `catalog.ts`.
2. Give it a stable lowercase key. Never rename a key after persisted data exists.
3. Choose `single_call` or `tool_cycle`.
4. Select only keys present in `tools/registry.ts`.
5. Select transitions only to other catalog flows and never to itself.
6. Run `npm test`; `catalog.test.ts` verifies these relationships.
7. Start the app once so initialization inserts the flow in an empty database.

After insertion, edits in `/dashboard/fluxos` publish an immutable version.
Existing assignments retain their version until completion or transition.

## Change an existing default

Changing a catalog entry does not overwrite a stored flow. This protects
operator edits. Existing installations require an explicit migration.

## Migrations

Create a focused module under `flows/migrations/` only when persisted data must
change. A migration should have a stable identifier, be idempotent, preserve
audit history, update versions intentionally and include a before/after test.
Remove it from the hot path after every environment has applied it.

Do not place one-off migrations in `flows.ts`.