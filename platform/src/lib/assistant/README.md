# Assistant architecture

This directory contains the conversational assistant runtime. Flows decide
when a capability may be used; registered tools decide how that capability is
validated and executed.

## Runtime path

1. `queue.ts` claims a debounced inbound-message job.
2. `processor.ts` loads the customer, context and assigned flow.
3. `azure-openai.ts` calls the model with `prompt.ts` and `schema.ts`.
4. A `tool_cycle` flow may return up to two ordered `toolCalls`.
5. `tools/execution.ts` authorizes and executes calls through the registry.
6. The processor records the run, applies its transition and sends the reply.

## Ownership

| Area | Owner |
| --- | --- |
| Shared flow documents | `flows/contracts.ts` |
| Built-in flow identities and defaults | `flows/catalog.ts` |
| Flow persistence collections | `flows/repository.ts` |
| Flow business operations | `flows.ts` |
| Tool contracts | `tools/contracts.ts` |
| Available tool keys and metadata | `tools/registry.ts` |
| Authorization and ordered execution | `tools/execution.ts` |
| Model output schema | `schema.ts` |
| Model instructions and parsing | `prompt.ts` |

## Invariants

- The model can request at most two tools per response.
- At most one mutating tool is allowed, and it must be last.
- Only tools allowed by the active flow version appear in the model schema.
- Executors validate authorization-sensitive arguments server-side.
- UI metadata, keys, schemas, instructions and dispatch derive from registry.
- A flow assignment keeps its published version until transition or reassignment.
- Every generation receives the accumulated summary and the configured window of
	most recent raw messages; the raw transcript is authoritative for dialogue details.

## Lead qualification

When `customer.update_profile` completes all required profile fields, it invokes an
isolated analysis from `qualification/customer-lead.ts`. The versioned result is
stored in `crm_customers.leadQualification` and can be refreshed from the customer
page. Only city, state, neighborhood, age, profession and minimized recent messages
are sent to this analysis; direct identifiers and the street address are excluded.

The occupation compensation range is a broad market benchmark, not an estimate of
the customer's income. Age, location, profession and that benchmark never contribute
to commercial readiness, which is based only on explicit conversation signals.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

See [tools/README.md](tools/README.md) and [flows/README.md](flows/README.md).