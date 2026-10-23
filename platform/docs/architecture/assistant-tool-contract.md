# Assistant tool contract decision

## Status

Accepted on 2026-09-01.

## Decision

Each model iteration uses a generic, namespaced `tool_request` action:

```json
{
  "type": "tool_request",
  "reasonCode": "need_authoritative_data",
  "toolCall": {
      "tool": "calendar.find_slots",
      "arguments": {
        "purpose": "book",
        "dateIntent": "exact_date",
        "fromDate": "2026-09-02",
        "horizonDays": 1,
        "period": "morning",
        "preferredTime": null,
        "ranking": "earliest",
        "candidateCount": 3,
        "eventType": "consultation",
        "planKey": null,
        "stepCriteria": []
      }
  }
}
```

The TypeScript registry is the source of truth for keys, metadata, argument
schemas, prompt instructions, mutation classification and execution. The active
agent configuration persists only the tool keys it authorizes.

Calendar behavior is exposed through five intent-level tools:

- `calendar.list_appointments` accepts only `{}` and lists the runtime customer's
  future confirmed appointments for authorized event types, ordered by start
  time. It returns at most 50 results with `hasMore`, local dates/times, resource
  names and the clinic timezone. Customer identity, current time and limit are
  fixed by the server; model-supplied arguments are rejected. No arbitrary date
  horizon is applied. Temporary holds, past/in-progress, cancelled and completed
  appointments are excluded.
- `calendar.find_slots` returns server-persisted candidates for one event or a
  configured multi-step plan.
- `calendar.hold` temporarily reserves a confirmed candidate while awaiting
  the deposit.
- `calendar.book` consumes a confirmed booking candidate.
- `calendar.reschedule` moves the existing event or group using a confirmed
  rescheduling candidate in one mutation.

Listing existing appointments does not select a rescheduling target or generate
a candidate, and is not a mandatory step before a search or reschedule.
Multiple listed appointments are a valid read result, not an ambiguity error.
The operational rescheduling flow starts with `calendar.find_slots` and
`purpose=reschedule`; the server must identify a unique compatible appointment
or group and binds it to the replacement candidates. If clarifying the event
type or plan cannot resolve the target, the assistant hands off instead of
guessing. The current API cannot select an appointment from the listing by ID
or position. The flow
does not use `calendar.hold`, `payment.request_deposit` or `calendar.book`.

Agent Studio discovers listing metadata from the registry. New configurations
enable it by default, while existing allowlists remain unchanged. The migration
preserves `calendar.list_appointments` rather than aliasing it to slot search.

The model cannot provide a customer ID, operating window, appointment ID or
end date. The server derives customer ownership from execution context, the
search end from `horizonDays`, and valid operating intervals from event type to
resource to weekly availability. Search results include ISO 8601 values with
offset plus local date, local time, weekday and timezone.

For multi-step plans, `stepCriteria` may override the global date, horizon,
period and exact start time for individual configured step keys. Unspecified
steps inherit the global search criteria. These values express customer
constraints only; they never override resource availability. Read-only search
runs immediately when the request is clear, while booking and rescheduling
still require explicit customer confirmation.

Availability conflicts are scoped to the configured resource. Appointments
using different professionals or resources may overlap; for example, a
technician may perform bioimpedance while the doctor attends another patient.

Configured plan constraints such as required steps and ordering remain hard
business rules. Rankings such as `compact`, `earliest` and `latest` are soft
selection strategies: consecutive steps are preferred by default, but explicit
customer dates, periods and times take priority. A compact search may return a
non-adjacent valid combination when no consecutive combination exists.
Auxiliary single-event searches are used only when the configured journey
permits them; a whole-plan-only policy must not be bypassed.

The new-booking journey for a plan with a pending deposit is search, explicit
candidate choice, temporary hold, required profile completion and accepted
deposit request. The server returns `holdExpiresAt`; instructions must not
hardcode a hold duration. Payment confirmation promotes the hold automatically,
so the assistant must not also call `calendar.book`. Holds do not accept
single-event candidates.

Relationship-only answers use `customer.classify_relationship`. A message that
also provides profile data uses `customer.update_profile` once, including the
relationship. Follow-up collection uses the refreshed
`runtime.customer.configuredMissingFields`, not every optional field in the
general profile. Read-only calendar questions do not require profile completion.

`runtime.operations.paymentProvider` exposes only the active payment mode, not
credentials. Deposit instructions require a real payer email for Mercado Pago
and no email for manual Pix. Charges require consent to pay, not proof of a
payment that has not yet been requested. Operational payment failures must not
claim a human handoff was registered.

## Why

The previous `calendarActions` envelope required synchronized changes in the
schema, parser, processor, API and UI. Namespaced calls allow new domains
without adding domain branches to orchestration.

## Consequences

- Executable behavior requires a deploy and review.
- Agent configuration authorizes registered tools without processor changes.
- Definitions lazy-load infrastructure so the registry remains import-safe.
- Arguments are schema-validated and validated again by the executor.
- Calendar mutation candidates are claimed before use and cannot be consumed
  twice. Grouped rescheduling is transactional.
- Fixed tool instructions are protected registry metadata. Agent Studio may
  append bounded additional guidance but cannot replace schemas or safety rules.
- Results contain `executedTools` and `results`.
- `$previous.<path>` references to arrays require a single-item result.
- There is no compatibility parser for `calendarActions`; the database was
  empty when this contract was adopted.