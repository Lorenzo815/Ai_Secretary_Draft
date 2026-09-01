import { describe, expect, it } from "vitest";
import {
  isValidBirthDate,
  isValidCpf,
  isValidFullName,
  isValidPhone,
  normalizeCpf,
  normalizePhone,
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
});