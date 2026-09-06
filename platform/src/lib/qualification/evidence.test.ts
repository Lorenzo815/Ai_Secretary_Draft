import { describe, expect, it } from "vitest";
import { assertInsightTagEvidence } from "./evidence";

const messages = [
  { messageId: "message-1", text: "Olá, qual o preço da consulta?" },
  { messageId: "message-2", text: "Ainda achei caro." },
];

describe("qualification insight tag evidence", () => {
  it("accepts a literal excerpt from the referenced message", () => {
    expect(() => assertInsightTagEvidence([{
      label: "Objeção de preço",
      evidence: [{ messageId: "message-2", excerpt: "Ainda achei caro." }],
    }], messages)).not.toThrow();
  });

  it("rejects an unknown message reference", () => {
    expect(() => assertInsightTagEvidence([{
      label: "Objeção de preço",
      evidence: [{ messageId: "unknown", excerpt: "Ainda achei caro." }],
    }], messages)).toThrow("mensagem inexistente");
  });

  it("rejects a paraphrase that is not present in the message", () => {
    expect(() => assertInsightTagEvidence([{
      label: "Objeção de preço",
      evidence: [{ messageId: "message-2", excerpt: "O preço está acima do orçamento." }],
    }], messages)).toThrow("não corresponde");
  });
});