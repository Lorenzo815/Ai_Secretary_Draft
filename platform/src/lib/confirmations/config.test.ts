import { describe, expect, it, vi } from "vitest";

vi.mock("../mongodb", () => ({ default: Promise.resolve({}) }));
vi.mock("../companies/tenant-db", () => ({ tenantDb: vi.fn() }));
vi.mock("../companies/context", () => ({ scopedSettingsId: vi.fn(), withCurrentCompany: vi.fn() }));

import { DEFAULT_CONFIRMATION_SETTINGS, validateConfirmationSettings } from "./config";

describe("confirmation settings validation", () => {
  const settings = { ...DEFAULT_CONFIRMATION_SETTINGS, enabled: true, firstSendHoursBefore: 36, intervalMinutes: 180 };

  it("saves settings every event time can fully use", () => {
    expect(validateConfirmationSettings(settings)).toMatchObject({ enabled: true, firstSendHoursBefore: 36, intervalMinutes: 180 });
  });

  it("refuses to activate settings that can't send every reminder with time left for an encaixe", () => {
    expect(() => validateConfirmationSettings({ ...settings, intervalMinutes: 360 }))
      .toThrow("Configuração impossível. Eventos às 08:00: só 2 de 3 envios cabem antes do horário. (e mais 1 faixa(s) de horário)");
  });

  it("still saves impossible settings while the task is off, so it can always be turned off", () => {
    expect(validateConfirmationSettings({ ...settings, enabled: false, intervalMinutes: 360 })).toMatchObject({ enabled: false, intervalMinutes: 360 });
  });
});
