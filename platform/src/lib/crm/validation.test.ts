import { describe, expect, it } from "vitest";
import {
  isValidBirthDate,
  isValidCpf,
  isValidFullName,
  isValidPhone,
  getWhatsAppPhoneAliases,
  normalizeCpf,
  normalizePhone,
  normalizeWhatsAppPhone,
} from "./validation";

describe("customer profile validation", () => {
  it("normalizes and validates CPF check digits", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("10836184903")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("requires a full name and a past ISO birth date", () => {
    expect(isValidFullName("Maria da Silva")).toBe(true);
    expect(isValidFullName("Maria")).toBe(false);
    expect(isValidBirthDate("1990-02-28")).toBe(true);
    expect(isValidBirthDate("1990-02-30")).toBe(false);
    expect(isValidBirthDate("2990-01-01")).toBe(false);
  });

  it("normalizes and bounds phone numbers", () => {
    expect(normalizePhone("+55 (11) 98765-4321")).toBe("5511987654321");
    expect(isValidPhone("+55 (11) 98765-4321")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
  });

  it("canonicalizes Brazilian WhatsApp numbers for deduplication", () => {
    expect(normalizeWhatsAppPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsAppPhone("+55 (11) 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsAppPhone("(42) 8807-6200")).toBe("5542988076200");
    expect(normalizeWhatsAppPhone("+55 (42) 8807-6200")).toBe("5542988076200");
    expect(normalizeWhatsAppPhone("(42) 3333-4444")).toBe("554233334444");
    expect(normalizeWhatsAppPhone("+1 202 555 0100")).toBe("12025550100");
    expect(getWhatsAppPhoneAliases("+55 (42) 98807-6200")).toEqual([
      "5542988076200",
      "554288076200",
    ]);
  });
});