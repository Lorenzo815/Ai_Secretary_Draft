import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";

const { operational, environment } = vi.hoisted(() => ({ operational: vi.fn(), environment: vi.fn() }));
vi.mock("./embedded-signup", () => ({ getOperationalEmbeddedSignupConfig: operational }));
vi.mock("./client", () => ({ getWhatsAppConfig: environment }));

const config = { businessAccountId: "12345", phoneNumberId: "67890", accessToken: "fake-token", graphVersion: "v25.0" };
const template = { id: "1", name: "confirmation", language: "pt_BR", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Confirma?" }] };
let api: typeof import("./templates");
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  operational.mockResolvedValue(config);
  environment.mockReturnValue(null);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [template] }) });
  vi.stubGlobal("fetch", fetchMock);
  api = await import("./templates");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("company template catalog cache", () => {
  it("shares in-flight lookups and refreshes after fifteen minutes", async () => {
    expect(await Promise.all([
      api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345"),
      api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345"),
    ])).toEqual([[template], [template]]);
    expect(operational).toHaveBeenCalledWith(legacyCompanyId());
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1);
    await api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects another company or a mismatched WABA before querying Graph", async () => {
    await expect(api.getCachedWhatsAppTemplates(new ObjectId(), "12345"))
      .rejects.toThrow("WHATSAPP_TEMPLATE_COMPANY_NOT_OPERATIONAL");
    await expect(api.getCachedWhatsAppTemplates(legacyCompanyId(), "other"))
      .rejects.toThrow("WHATSAPP_TEMPLATE_WABA_MISMATCH");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proactively warms the same cache used for message enrichment", async () => {
    expect(await api.refreshWhatsAppTemplateCatalog()).toEqual({ configured: true, count: 1 });
    await api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not treat an unconfigured integration as an empty successful catalog", async () => {
    operational.mockResolvedValue(null);
    expect(await api.refreshWhatsAppTemplateCatalog()).toEqual({ configured: false, count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("backs off failed fetches without hiding the error, then allows recovery", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345")).rejects.toThrow("Network unavailable");
    await expect(api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345")).rejects.toThrow("Network unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345")).toEqual([template]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("follows cursors without fetching provider-supplied next URLs", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({
        data: [template], paging: { next: "https://untrusted.example/ignored", cursors: { after: "cursor-2" } },
      }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ data: [{ ...template, id: "2", name: "second" }] }),
    });
    expect(await api.listWhatsAppTemplates()).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain("https://graph.facebook.com/v25.0/12345/message_templates?");
    expect(fetchMock.mock.calls[1][0]).toContain("after=cursor-2");
  });

  it("reports invalid pagination instead of silently truncating the catalog", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [template], paging: { next: "next" } }) });
    await expect(api.listWhatsAppTemplates()).rejects.toThrow("WHATSAPP_TEMPLATE_PAGINATION_INVALID");
  });

  it("invalidates the cache after creating a template", async () => {
    await api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "2", status: "PENDING", category: "UTILITY" }) });
    await api.createWhatsAppTemplate({ name: "new_template", language: "pt_BR", category: "UTILITY", body: "Texto fixo." });
    await api.getCachedWhatsAppTemplates(legacyCompanyId(), "12345");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not turn malformed responses into a successful empty catalog", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(api.listWhatsAppTemplates()).rejects.toThrow("WHATSAPP_TEMPLATE_CATALOG_INVALID");
  });
});
