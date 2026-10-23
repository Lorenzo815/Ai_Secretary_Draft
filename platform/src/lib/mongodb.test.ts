import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { close, connect, constructor } = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("mongodb", () => ({
  MongoClient: class {
    constructor(uri: string, options: unknown) {
      constructor(uri, options);
    }

    connect() {
      return connect().then(() => this);
    }

    close() {
      return close();
    }
  },
}));

describe("MongoDB connection lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.env.MONGODB_URI = "mongodb://example.test/database";
    delete (globalThis as { _mongoClientPromise?: Promise<unknown> })._mongoClientPromise;
    close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { _mongoClientPromise?: Promise<unknown> })._mongoClientPromise;
  });

  it("connects lazily through the explicit accessor and shares the existing pool", async () => {
    connect.mockResolvedValue(undefined);
    const { default: clientPromise, getMongoClient } = await import("./mongodb");
    expect(constructor).not.toHaveBeenCalled();

    const firstClient = getMongoClient();
    expect(getMongoClient()).toBe(firstClient);
    await expect(clientPromise).resolves.toBe(await firstClient);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("retries a connection reset and then reuses the recovered client", async () => {
    connect
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { cause: { code: "ECONNRESET" } }))
      .mockResolvedValue(undefined);
    const { default: clientPromise, getMongoClient } = await import("./mongodb");

    const firstClient = getMongoClient();
    await vi.advanceTimersByTimeAsync(250);

    await expect(firstClient).resolves.toBeDefined();
    await expect(clientPromise).resolves.toBe(await firstClient);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("clears a failed connection so a later request can reconnect", async () => {
    connect.mockRejectedValueOnce(new Error("authentication failed"));
    const { default: clientPromise, getMongoClient } = await import("./mongodb");

    await expect(getMongoClient()).rejects.toThrow("authentication failed");

    connect.mockResolvedValueOnce(undefined);
    await expect(clientPromise).resolves.toBeDefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
