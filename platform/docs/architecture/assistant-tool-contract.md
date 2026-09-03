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
      "name": "calendar.check_availability",
      "arguments": {
        "dateIntent": "exact_date",
        "fromDate": "2026-09-02",
        "toDate": "2026-09-02",
        "period": "morning",
        "eventType": "consultation"
      }
  }
}
```

The TypeScript registry is the source of truth for keys, metadata, argument
schemas, prompt instructions, mutation classification and execution. The active
agent configuration persists only the tool keys it authorizes.

## Why

The previous `calendarActions` envelope required synchronized changes in the
schema, parser, processor, API and UI. Namespaced calls allow new domains
without adding domain branches to orchestration.

## Consequences

- Executable behavior requires a deploy and review.
- Agent configuration authorizes registered tools without processor changes.
- Definitions lazy-load infrastructure so the registry remains import-safe.
- Arguments are schema-validated and validated again by the executor.
- Results contain `executedTools` and `results`.
- `$previous.<path>` references to arrays require a single-item result.
- There is no compatibility parser for `calendarActions`; the database was
  empty when this contract was adopted.