# Adding a tool

A tool is a server-side capability exposed by the active agent configuration. It is
registered in code because enabling it grants real behavior to the assistant.

## Layout

Use one pair of files per domain:

```text
tools/
  example-definitions.ts  # metadata, schemas and prompt instructions
  example.ts              # server-only validation and execution
```

Definitions must not eagerly import databases or external clients. Dynamically
import the executor, as `calendar-definitions.ts` does. This keeps metadata and
schemas usable by APIs, UI and tests without initializing infrastructure.

## Checklist

1. Add a `ToolDefinition` to the domain definitions file.
2. Set `mutates=true` if it writes any state.
3. Use a strict argument schema with `additionalProperties=false`.
4. Validate authorization and business rules again in the executor.
5. Return JSON with `ok`, `tool` and result data or an error.
6. Add the domain definitions to `toolRegistry` in `registry.ts`.
7. Add the key to the default configuration when it should start enabled.
8. Extend registry tests when introducing a new invariant.
9. Run the validation commands from the assistant README.

## Minimal definition

```ts
export const customerToolDefinitions = {
  "customer.get_profile": {
    label: "Consultar cadastro",
    description: "Consulta dados administrativos do cliente atual.",
    mutates: false,
    argumentsSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
    promptInstructions: "Use esta tool somente para dados cadastrais.",
    execute: async (context, args) =>
      (await import("./customer")).getProfile(context, args),
  },
} satisfies Record<string, ToolDefinition>;
```

Do not add tool-specific branches to `processor.ts`, `schema.ts`, the Studio API
or dashboard. Extend the generic contract first if a new invariant is needed.