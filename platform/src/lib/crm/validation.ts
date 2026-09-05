export class CustomerProfileValidationError extends Error {
  name = "CustomerProfileValidationError";
}

export function normalizeCpf(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidCpf(value: string) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    const sum = cpf.slice(0, length).split("").reduce(
      (total, number, index) => total + Number(number) * (length + 1 - index),
      0,
    );
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidPhone(value: string) {
  const phone = normalizePhone(value);
  return phone.length >= 10 && phone.length <= 13;
}

export function isValidFullName(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length >= 2;
}

export function isValidBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  const now = new Date();
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) && date < now && date.getUTCFullYear() >= 1900;
}