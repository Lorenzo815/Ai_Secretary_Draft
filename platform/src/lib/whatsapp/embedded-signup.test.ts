import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOne, replaceOne } = vi.hoisted(() => ({
  findOne: vi.fn(),
  replaceOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection: () => ({ findOne, replaceOne }) }),
  }),
}));

import {
  getEmbeddedSignupConfiguration,
  updateEmbeddedSignupConfiguration,
} from "./embedded-signup";

describe("Embedded Signup configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOne.mockResolvedValue(null);
    replaceOne.mockResolvedValue({ acknowledged: true });
  });

  it("returns an unconfigured v25 default", async () => {
    await expect(getEmbeddedSignupConfiguration()).resolves.toMatchObject({
      appId: "",
      configurationId: "",
      graphVersion: "v25.0",
      updatedAt: null,
    });
  });

  it("persists normalized public Meta identifiers", async () => {
    const result = await updateEmbeddedSignupConfiguration({
      appId: " 1234567890 ",
      configurationId: "9876543210",
    });

    expect(result).toMatchObject({ appId: "1234567890", configurationId: "9876543210" });
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: "active" },
      expect.objectContaining({ appId: "1234567890", configurationId: "9876543210" }),
      { upsert: true },
    );
  });

  it("rejects values that are not Meta numeric IDs", async () => {
    await expect(updateEmbeddedSignupConfiguration({
      appId: "app-secret",
      configurationId: "9876543210",
    })).rejects.toThrow("App ID deve conter apenas números.");
  });
});