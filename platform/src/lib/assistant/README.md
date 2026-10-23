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
- Relationship classification does not imply a service-status change.
  Agent Studio > Conversa configures `relationshipRouting` separately for `new`
  and `returning`: `preserve` (default), `ai_active`, or `waiting_human`.
  Both customer tools use the pinned policy, and the CRM applies routing only
  when explicitly requested. Profile updates apply it only when first recording
  the relationship. Existing human-assigned chats are not reactivated by migration.
  General handoff instructions and independent safety handoffs still apply.
- `calendar.list_appointments` accepts only `{}` and reads future scheduled
  appointments and unexpired holds for the runtime customer across all event types,
  independently of booking permissions.
  The server fixes identity, time and the 50-result limit; `hasMore` reports
  truncation. Cancelled/completed events, expired holds and appointments already
  started are excluded. Confirmation status, hold expiry and type-level scheduling
  scope are explicit; a scheduled appointment is not necessarily confirmed.
  No notes, contact details or customer/appointment IDs are returned.
- Agent Studio derives the appointment lookup's checkbox and protected
  instructions from the registry. It is enabled in new default configurations;
  existing tool permissions are preserved and may be updated in Studio.
- Appointment lookup only reports existing times. Rescheduling still requires
  `calendar.find_slots` with `purpose=reschedule`, followed by one confirmed
  `calendar.reschedule`; it never uses hold, deposit or booking in that flow.
- Rescheduling also moves an active pending-deposit hold in place, preserving its
  payment request and renewing the configured hold duration from the move, capped
  at the first step's start. Appointment changes, source hold metadata and candidate
  consumption share a transaction. Booking prerequisites remain required for
  scheduled targets, but do not block moving an existing unpaid hold.
- Appointment lookup is optional before a search. Only the rescheduling search
  resolves a unique compatible target; multiple listed appointments are not an
  error and do not authorize selecting an event by ID or list position.
- The plan deposit journey reserves an explicitly chosen candidate before
  collecting remaining required fields and requesting payment. Hold expiry
  comes from `holdExpiresAt`, and payment promotes the hold without another
  booking call. Holds are not available for single-event candidates.
- Profile collection follows refreshed configured missing fields. Relationship
  and profile data volunteered together are saved in one profile update.
- The runtime exposes the active payment mode without credentials so payer
  email collection follows the current provider rather than saved assumptions.
- A new inbound message invalidates the pending follow-up before scheduling its normal response.
- Follow-ups are sent only inside the configured active hours, before the WhatsApp 24-hour cutoff and while no future appointment exists.
- Drop-off analysis is evidence-based; silence alone is not treated as proof of lost interest.

## Customer conversation cleanup

System Settings offers a customer-only `customer_history` deletion scope.
It requires paused AI processing, a selected customer and explicit `APAGAR`
confirmation. Running conversation jobs or a live qualification analysis block
cleanup until they finish.

A transaction removes messages, conversation summaries/facts, agent runs/steps,
qualification history and pending conversation-related jobs. It resets the
customer's derived qualification and message-attention marker, not their profile,
relationship, service status, appointments, holds, payments or AI usage metrics.
Legacy unassigned messages are matched by phone aliases; messages explicitly
owned by another customer are excluded. This only clears platform history, not
messages stored in the customer's WhatsApp.

## Validation

```bash
npm test
npm run lint
npm exec tsc -- --noEmit
npm run build
```