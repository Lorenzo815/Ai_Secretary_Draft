# Assistant tool contract decision

## Status

Accepted on 2026-09-01.

## Decision

Model responses use a generic, namespaced `toolCalls` envelope:

```json
{
  "toolCalls": [
    {
      "tool": "calendar.check_availability",
      "arguments": {
        "dateIntent": "exact_date",
        "fromDate": "2026-09-02",
        "toDate": "2026-09-02",
        "period": "morning",
        "eventType": "consultation"
      }
    }
  ]
}
```

The TypeScript registry is the source of truth for keys, metadata, argument
schemas, prompt instructions, mutation classification and execution. Flows
persist only the tool keys they authorize.

## Why

The previous `calendarActions` envelope required synchronized changes in the
schema, parser, processor, API and UI. Namespaced calls allow new domains
without adding domain branches to orchestration.

## Consequences

- Executable behavior requires a deploy and review.
- Flows authorize registered tools without processor changes.
- Definitions lazy-load infrastructure so the registry remains import-safe.
- Arguments are schema-validated and validated again by the executor.
- Results contain `executedTools` and `results`.
- `$previous.<path>` references to arrays require a single-item result.
- There is no compatibility parser for `calendarActions`; the database was
  empty when this contract was adopted.