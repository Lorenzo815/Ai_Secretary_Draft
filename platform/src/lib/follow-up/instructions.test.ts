import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS,
  DEFAULT_FOLLOW_UP_PROMPT,
  getFollowUpAttemptInstruction,
} from "./instructions";

describe("follow-up instructions", () => {
  it("requires a genuinely new and low-friction persuasion strategy", () => {
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("Uma redação diferente do mesmo argumento não é uma nova abordagem");
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("Não repita uma pergunta ignorada");
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("conecte no máximo um diferencial autorizado àquele objetivo");
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("ofereça no máximo duas alternativas claras");
  });

  it("prevents repeated price defenses and coercive follow-ups", () => {
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("não volte a defender o valor com a mesma lista");
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("Não invente desconto, parcelamento");
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("não use culpa, pressão, urgência ou escassez artificial");
    expect(DEFAULT_FOLLOW_UP_PROMPT).toContain("com no máximo uma pergunta concreta");
  });

  it("selects secondary instructions by attempt and reuses the final strategy", () => {
    expect(getFollowUpAttemptInstruction(DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS, 1)).toContain("Primeira tentativa");
    expect(getFollowUpAttemptInstruction(DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS, 2)).toContain("Segunda tentativa");
    expect(getFollowUpAttemptInstruction(DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS, 8)).toContain("Terceira tentativa em diante");
  });
});