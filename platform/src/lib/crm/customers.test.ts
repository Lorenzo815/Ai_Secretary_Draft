import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { collection, createIndex, findOne, findOneAndUpdate } = vi.hoisted(() => ({
  collection: vi.fn(),
  createIndex: vi.fn().mockResolvedValue("index"),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
}));

import { findOrCreateCustomerFromWhatsApp, revealCustomerCpf, updateCustomer, updateCustomerProfile } from "./customers";

describe("updateCustomerProfile address updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ createIndex, findOne, findOneAndUpdate });
  });

  afterEach(() => vi.restoreAllMocks());

  it("reuses a customer stored with the legacy Brazilian mobile number", async () => {
    const customer = {
      _id: new ObjectId(),
      name: "Lorenzo Puppi",
      phones: ["554288076200"],
      identifiers: [{ kind: "whatsapp_phone", value: "554288076200", provider: "whatsapp" }],
    };
    findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(customer);

    await expect(findOrCreateCustomerFromWhatsApp({
      phone: "5542988076200",
      name: "Lorenzo Puppi",
      interactionAt: new Date("2026-09-28T14:44:00.000Z"),
    })).resolves.toBe(customer);

    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      {
        identifiers: {
          $elemMatch: {
            kind: "whatsapp_phone",
            value: "5542988076200",
          },
        },
      },
      expect.any(Object),
      { returnDocument: "after" },
    );
    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        identifiers: {
          $elemMatch: {
            kind: "whatsapp_phone",
            value: { $in: ["554288076200"] },
          },
        },
      },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          phones: ["5542988076200"],
          identifiers: [
            { kind: "whatsapp_phone", value: "5542988076200", provider: "whatsapp" },
          ],
        }),
      }),
      { returnDocument: "after" },
    );
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it("prefers the exact current mobile number when both formats exist", async () => {
    const currentCustomer = {
      _id: new ObjectId(),
      name: "Lorenzo Puppi",
      phones: ["5542988076200"],
      identifiers: [{ kind: "whatsapp_phone", value: "5542988076200", provider: "whatsapp" }],
    };
    findOneAndUpdate.mockResolvedValueOnce(currentCustomer);

    await expect(findOrCreateCustomerFromWhatsApp({
      phone: "5542988076200",
      name: "Lorenzo Puppi",
      interactionAt: new Date("2026-09-28T14:44:00.000Z"),
    })).resolves.toBe(currentCustomer);

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        identifiers: {
          $elemMatch: { kind: "whatsapp_phone", value: "5542988076200" },
        },
      },
      expect.any(Object),
      { returnDocument: "after" },
    );
  });

  it("does not resolve an unchanged postal code again", async () => {
    const customerId = new ObjectId();
    const customer = {
      _id: customerId,
      phones: ["5511999999999"],
      profile: {
        address: {
          postalCode: "12345-678",
          street: "Rua existente",
          neighborhood: "Bairro existente",
          city: "Cidade existente",
          state: "SP",
        },
        updatedAt: new Date(),
      },
    };
    findOne.mockResolvedValue(customer);
    findOneAndUpdate.mockResolvedValue({
      ...customer,
      profile: { ...customer.profile, address: { ...customer.profile.address, number: "123" } },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await updateCustomerProfile(customerId, {
      postalCode: "12345-678",
      addressNumber: "123",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: customerId },
      expect.objectContaining({
        $set: expect.objectContaining({ "profile.address.number": "123" }),
      }),
      { returnDocument: "after" },
    );
  });

  it("ignores repeated profile fields while saving a missing address number", async () => {
    const customerId = new ObjectId();
    const customer = {
      _id: customerId,
      phones: ["5511999999999"],
      relationship: { status: "new", source: "customer", classifiedAt: new Date() },
      profile: {
        fullName: "Nome Existente",
        birthDate: "1990-01-01",
        cpf: { encrypted: "stored", iv: "stored", authTag: "stored", hash: "stored", last4: "0000" },
        address: {
          postalCode: "12345678",
          street: "Rua existente",
          neighborhood: "Bairro existente",
          city: "Cidade existente",
          state: "SP",
        },
        profession: "Profissão existente",
        updatedAt: new Date(),
      },
    };
    findOne.mockResolvedValue(customer);
    findOneAndUpdate.mockResolvedValue(customer);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await updateCustomerProfile(customerId, {
      relationshipStatus: "new",
      fullName: "Valor repetido",
      birthDate: "invalid",
      cpf: "invalid",
      postalCode: "87654321",
      addressNumber: "123",
      profession: "Valor repetido",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    const update = findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
    expect(update.$set).toMatchObject({ "profile.address.number": "123" });
    expect(update.$set).not.toHaveProperty("relationship");
    expect(update.$set).not.toHaveProperty("profile.fullName");
    expect(update.$set).not.toHaveProperty("profile.birthDate");
    expect(update.$set).not.toHaveProperty("profile.cpf");
    expect(update.$set).not.toHaveProperty("profile.address");
    expect(update.$set).not.toHaveProperty("profile.profession");
  });

  it("encrypts a new CPF with the auth secret fallback in production", async () => {
    const previousPiiKey = process.env.PII_ENCRYPTION_KEY;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    const previousAuthSecret = process.env.AUTH_SECRET;
    delete process.env.PII_ENCRYPTION_KEY;
    process.env.NEXTAUTH_SECRET = "stable-auth-secret";
    delete process.env.AUTH_SECRET;
    const customerId = new ObjectId();
    const customer = {
      _id: customerId,
      phones: ["5511999999999"],
      profile: { updatedAt: new Date() },
    };
    findOne.mockResolvedValue(customer);
    findOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...customer,
      profile: {
        ...customer.profile,
        cpf: (update as { $set: Record<string, unknown> }).$set["profile.cpf"],
      },
    }));

    try {
      await updateCustomerProfile(customerId, { cpf: "529.982.247-25" });
    } finally {
      restoreEnvironment("PII_ENCRYPTION_KEY", previousPiiKey);
      restoreEnvironment("NEXTAUTH_SECRET", previousNextAuthSecret);
      restoreEnvironment("AUTH_SECRET", previousAuthSecret);
    }

    const update = findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
    const protectedCpf = update.$set["profile.cpf"] as Record<string, string>;
    expect(protectedCpf).toMatchObject({ last4: "4725" });
    expect(protectedCpf.encrypted).not.toContain("52998224725");
    expect(protectedCpf).toHaveProperty("iv");
    expect(protectedCpf).toHaveProperty("authTag");
    expect(protectedCpf).toHaveProperty("hash");
  });

  it("decrypts a stored CPF only when explicitly requested", async () => {
    const previousPiiKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = "dedicated-pii-secret";
    const customerId = new ObjectId();
    const customer = {
      _id: customerId,
      phones: ["5511999999999"],
      profile: { updatedAt: new Date() },
    };
    let protectedCpf: unknown;
    findOne
      .mockResolvedValueOnce(customer)
      .mockImplementationOnce(async () => ({
        ...customer,
        profile: { ...customer.profile, cpf: protectedCpf },
      }));
    findOneAndUpdate.mockImplementationOnce(async (_filter, update) => {
      protectedCpf = (update as { $set: Record<string, unknown> }).$set["profile.cpf"];
      return { ...customer, profile: { ...customer.profile, cpf: protectedCpf } };
    });

    try {
      await updateCustomerProfile(customerId, { cpf: "529.982.247-25" });
      await expect(revealCustomerCpf(customerId)).resolves.toBe("52998224725");
    } finally {
      restoreEnvironment("PII_ENCRYPTION_KEY", previousPiiKey);
    }

    expect(findOne).toHaveBeenLastCalledWith(
      { _id: customerId },
      { projection: { "profile.cpf": 1 } },
    );
  });

  it("allows staff to replace and clear the complete editable profile", async () => {
    const customerId = new ObjectId();
    const updatedAt = new Date("2026-09-01T12:00:00.000Z");
    const customer = {
      _id: customerId,
      name: "Nome anterior",
      phones: ["5511999999999", "5511888888888"],
      identifiers: [{ kind: "whatsapp_phone", value: "5511999999999", provider: "whatsapp" }],
      relationship: { status: "new", source: "customer", classifiedAt: new Date() },
      profile: {
        fullName: "Nome anterior",
        birthDate: "1990-01-01",
        profession: "Profissão anterior",
        address: {
          postalCode: "12345678",
          street: "Rua anterior",
          neighborhood: "Bairro",
          city: "Cidade",
          state: "SP",
        },
        updatedAt,
      },
      updatedAt,
    };
    findOne.mockResolvedValueOnce(customer).mockResolvedValueOnce(null);
    findOneAndUpdate.mockResolvedValue({ ...customer, name: "Nome atualizado" });

    await updateCustomer(customerId.toString(), {
      name: "Nome atualizado",
      fullName: "Nome Completo Atualizado",
      whatsapp: "(11) 97777-7777",
      relationshipStatus: null,
      birthDate: "",
      profession: "",
      postalCode: "",
      secondaryPhones: ["(11) 96666-6666"],
    });

    const [, update] = findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: { name: string; phones: string[]; profile: Record<string, unknown> }; $unset: { relationship: string } },
    ];
    expect(update.$set.name).toBe("Nome atualizado");
    expect(update.$set.profile).toMatchObject({ fullName: "Nome Completo Atualizado" });
    expect(update.$set.phones).toEqual(["5511977777777", "5511966666666"]);
    expect(update.$set.profile).not.toHaveProperty("birthDate");
    expect(update.$set.profile).not.toHaveProperty("profession");
    expect(update.$set.profile).not.toHaveProperty("address");
    expect(update.$unset).toEqual({ relationship: "" });
  });
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}