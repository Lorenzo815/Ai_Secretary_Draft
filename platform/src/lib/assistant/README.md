# Assistant architecture

The customer assistant is one configurable agent. Automation rules decide when
to run it; the agent decides between one final response and one tool request per
model iteration.

## Runtime path

1. Domain events are matched against mutable rules in `../automation`.
2. The automation queue leases a `customer_agent` job.
3. `agent/orchestrator.ts` pins the latest active configuration for that job.
4. Runtime context loads authoritative customer, payment, calendar and local-time facts.
5. The model returns either `final` or one `tool_request` using a strict schema.
6. Tool results accumulate until a final response or a configured hard limit.
7. Runs and steps are recorded with a safe configuration snapshot.
8. Eligible replies schedule a `customer_follow_up` job.
9. A follow-up reuses the agent with an explicit trigger and schedules the next cycle after sending.
10. Only a successfully sent follow-up schedules the independent lead-qualification job.

## Ownership

| Area | Owner |
| --- | --- |
| Mutable agent configuration | `agent/repository.ts` |
| Prompt compilation | `agent/prompt.ts` |
| Strict action schema | `agent/schema.ts` |
| Runtime loop and audit | `agent/orchestrator.ts`, `agent/runs.ts` |
| Available capabilities | `tools/registry.ts` |
| Server authorization and execution | `tools/execution.ts`, tool modules |
| Generic triggers and jobs | `../automation` |
| Independent lead qualification | `../qualification` |
| Follow-up policy and eligibility | `../follow-up` |

## Invariants

- Each model iteration produces exactly one final response or one tool request.
- The server independently validates tool authorization, arguments and mutations.
- Internal iteration limits never limit the number of customer messages.
- Relative dates use the clinic's authoritative local time.
- Pix secrets are exposed only by the payment tool after server-side checks.
- Scheduling plans use configurable steps and deterministic constraints.
- Each claimed job pins one configuration revision for its full execution.
- A new inbound message invalidates the pending follow-up before scheduling its normal response.
- Follow-ups are sent only inside the configured active hours, before the WhatsApp 24-hour cutoff and while no future appointment exists.
- Drop-off analysis is evidence-based; silence alone is not treated as proof of lost interest.

## Validation

```bash
npm test
npm run lint
npm exec tsc -- --noEmit
npm run build
```