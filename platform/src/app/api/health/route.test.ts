import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { command, getMongoClient } = vi.hoisted(() => ({ command: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getMongoClient }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  getMongoClient.mockResolvedValue({ db: () => ({ command }) });
  command.mockResolvedValue({ ok: 1 });
});

describe("health probe", () => {
  it("reports liveness without touching the database", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(getMongoClient).not.toHaveBeenCalled();
  });
  it("pings MongoDB when the database check is requested", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/health?db=1"));
    expect(response.status).toBe(200);
    expect(command).toHaveBeenCalledWith({ ping: 1 });
  });
  it("returns 503 without leaking error details when MongoDB is unavailable", async () => {
    command.mockRejectedValue(new Error("connection string with secrets"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(new NextRequest("http://localhost:3000/api/health?db=1"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secrets");
    log.mockRestore();
  });
});
