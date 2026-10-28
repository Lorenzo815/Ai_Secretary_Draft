import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { collection, createIndex, findOne, findOneAndUpdate, find, sort, skip, limit, toArray } = vi.hoisted(() => ({
  collection: vi.fn(),
  createIndex: vi.fn().mockResolvedValue("index"),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  find: vi.fn(),
  sort: vi.fn(),
  skip: vi.fn(),
  limit: vi.fn(),
  toArray: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
}));

import { findOrCreateCustomerFromWhatsApp, listCustomerOptions, listCustomerOptionsPage, revealCustomerCpf, updateCustomer, updateCustomerProfile } from "./customers";
import { legacyCompanyId } from "../companies/ownership";

describe("client option queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ find });
    find.mockReturnValue({ sort });
    sort.mockReturnValue({ toArray });
    toArray.mockResolvedValue([]);
  });

  it("restricts appointment name lookups to linked client IDs without fetching profiles", async () => {
    const ids = [new ObjectId(), new ObjectId()];

    await listCustomerOptions(ids);

    expect(find).toHaveBeenCalledExactlyOnceWith(
      { _id: { $in: ids } },
      { projection: { name: 1, phones: 1, createdAt: 1 } },
    );
  });

  it("does not turn an empty list of IDs into a directory-wide query", async () => {
    expect(await listCustomerOptions([])).toEqual([]);
    expect(collection).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("preserves the directory lookup for the event form", async () => {
    await listCustomerOptions();

    expect(find).toHaveBeenCalledExactlyOnceWith(
      {},
      { projection: { name: 1, phones: 1, createdAt: 1 } },
    );
    expect(sort).toHaveBeenCalledExactlyOnceWith({ name: 1 });
  });
});

describe("bounded calendar client search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const cursor = { sort, skip, limit, toArray };
    collection.mockReturnValue({ find, createIndex });
    find.mockReturnValue(cursor);
    sort.mockReturnValue(cursor);
    skip.mockReturnValue(cursor);
    limit.mockReturnValue(cursor);
    toArray.mockResolvedValue([]);
  });

  it("initializes locale-aware sort indexes once and reuses them for subsequent searches", async () => {
    await listCustomerOptionsPage();
    await listCustomerOptionsPage({ query: "Maria" });

    expect(createIndex).toHaveBeenCalledTimes(2);
    expect(createIndex).toHaveBeenCalledWith(
      { name: 1, _id: 1 },
      { name: "customer_options_alphabetical", collation: { locale: "pt", strength: 1 } },
    );
    expect(createIndex).toHaveBeenCalledWith(
      { createdAt: -1, name: 1, _id: 1 },
      { name: "customer_options_recent", collation: { locale: "pt", strength: 1 } },
    );
  });

  it.each([0, 24, 25, 26])("returns at most 25 of %i matches with an exact hasMore flag", async (count) => {
    const customers = Array.from({ length: count }, () => ({ _id: new ObjectId(), name: "Client" }));
    toArray.mockResolvedValue(customers);

    expect(await listCustomerOptionsPage()).toEqual({
      customers: customers.slice(0, 25), page: 1, pageSize: 25, hasMore: count > 25,
    });
    expect(limit).toHaveBeenCalledExactlyOnceWith(26);
    expect(skip).toHaveBeenCalledExactlyOnceWith(0);
    expect(sort).toHaveBeenCalledExactlyOnceWith({ createdAt: -1, name: 1, _id: 1 });
    expect(find).toHaveBeenCalledExactlyOnceWith(
      {},
      { projection: { name: 1, phones: 1, createdAt: 1 }, collation: { locale: "pt", strength: 1 } },
    );
  });

  it("paginates alphabetical results with stable ordering instead of loading the whole directory", async () => {
    await listCustomerOptionsPage({ page: 3, sort: "alphabetical" });

    expect(skip).toHaveBeenCalledExactlyOnceWith(50);
    expect(sort).toHaveBeenCalledExactlyOnceWith({ name: 1, _id: 1 });
    expect(limit).toHaveBeenCalledExactlyOnceWith(26);
  });

  it.each([
    ["joao", "Jo\u00e3o da Silva"],
    ["JO\u00c3O", "Joao da Silva"],
    ["lucia", "Lu\u0301cia Souza"],
    ["conceicao", "Maria Concei\u00e7\u00e3o"],
    ["silva", "Maria Silva Santos"],
  ])("preserves case- and accent-insensitive substring matching for %s", async (query, name) => {
    await listCustomerOptionsPage({ query });

    const filter = find.mock.calls[0][0];
    expect(new RegExp(filter.name.$regex, "iu").test(name)).toBe(true);
    expect(Object.keys(filter)).toEqual(["name"]);
  });

  it("treats regex characters literally rather than allowing wildcard searches", async () => {
    await listCustomerOptionsPage({ query: " Ana.* (VIP) " });

    const filter = find.mock.calls[0][0];
    const pattern = new RegExp(filter.name.$regex, "iu");
    expect(pattern.test("Ana.* (VIP)")).toBe(true);
    expect(pattern.test("Ana anything VIP")).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects invalid page %s before accessing the database", async (page) => {
    await expect(listCustomerOptionsPage({ page })).rejects.toThrow("página válida");
    expect(collection).not.toHaveBeenCalled();
  });

  it("rejects oversized searches before accessing the database", async () => {
    await expect(listCustomerOptionsPage({ query: "a".repeat(161) })).rejects.toThrow("160 caracteres");
    expect(collection).not.toHaveBeenCalled();
  });
});

describe("updateCustomerProfile address updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ createIndex, findOne, findOneAndUpdate });
  });

  afterEach(() => vi.restoreAllMocks());

  it("scopes exact, alias and insert lookups when ingesting company-validated echoes", async () => {
    const companyId = legacyCompanyId();
    const customer = { _id: new ObjectId() };
    findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(customer);
    await expect(findOrCreateCustomerFromWhatsApp({
      phone: "5542988076200", interactionAt: new Date(), companyId,
    })).resolves.toBe(customer);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(3);
    for (const [filter] of findOneAndUpdate.mock.calls) {
      expect(filter).toMatchObject({ companyId });
    }
  });

  it("does not enable a different company through the scoped ingestion helper", async () => {
    await expect(findOrCreateCustomerFromWhatsApp({
      phone: "5542988076200", interactionAt: new Date(), companyId: new ObjectId(),
    })).rejects.toThrow("não pode ser substituída");
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

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