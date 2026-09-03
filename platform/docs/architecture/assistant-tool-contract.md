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

Calendar behavior is exposed through three intent-level tools:

- `calendar.find_slots` returns server-persisted candidates for one event or a
  configured multi-step plan.
- `calendar.book` consumes a confirmed booking candidate.
- `calendar.reschedule` moves the existing event or group using a confirmed
  rescheduling candidate in one mutation.

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