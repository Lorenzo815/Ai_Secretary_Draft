import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration, DEFAULT_AGENT_IDENTITY } from "./defaults";

describe("default agent configuration", () => {
  it("keeps the original clinic's content", () => {
    const configuration = createDefaultAgentConfiguration();
    expect(configuration.identityPrompt).toBe(DEFAULT_AGENT_IDENTITY);
    expect(configuration.schedulingPlans.length).toBeGreaterThan(0);
  });

  it("starts a new clinic empty: no identity, conversation, style, journey, knowledge or plans", () => {
    const configuration = createDefaultAgentConfiguration({ blank: true });
    expect({
      identityPrompt: configuration.identityPrompt, conversationPolicy: configuration.conversationPolicy,
      responseStyle: configuration.responseStyle, journeyPolicy: configuration.journeyPolicy, knowledge: configuration.knowledge,
      schedulingPlans: configuration.schedulingPlans, bookableEventTypeKeys: configuration.bookableEventTypeKeys,
    }).toEqual({
      identityPrompt: "", conversationPolicy: "", responseStyle: "", journeyPolicy: "", knowledge: "",
      schedulingPlans: [], bookableEventTypeKeys: [],
    });
    expect(JSON.stringify(configuration)).not.toMatch(/Matheus|Busnardo|bioimped/i);
  });
});
