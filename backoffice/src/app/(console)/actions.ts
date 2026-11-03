"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/actions";
import { requireOwner } from "@/lib/auth";
import * as cleanup from "@/lib/cleanup";
import * as companies from "@/lib/companies";
import * as explorer from "@/lib/explorer";
import * as oria from "@/lib/oria-settings";

// ---------- data explorer ----------

export async function getDocumentAction(collection: string, id: string) {
  await requireOwner();
  return runAction(() => explorer.getDocument(collection, id));
}

export async function saveDocumentAction(collection: string, id: string, json: string, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    await explorer.saveDocument(actor, collection, id, json, confirmation);
    revalidatePath(`/data/${collection}`);
  }, "Documento salvo.");
}

export async function insertDocumentAction(collection: string, json: string, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    const id = await explorer.insertDocument(actor, collection, json, confirmation);
    revalidatePath(`/data/${collection}`);
    return id;
  }, "Documento criado.");
}

export async function deleteDocumentAction(collection: string, id: string, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    await explorer.deleteDocument(actor, collection, id, confirmation);
    revalidatePath(`/data/${collection}`);
  }, "Documento excluído.");
}

export async function previewBulkAction(input: { collection: string; company?: string; filter?: string; id?: string }) {
  await requireOwner();
  return runAction(async () => {
    const { count, production } = await explorer.previewBulk(input);
    return { count, production };
  });
}

export async function bulkWriteAction(input: {
  collection: string; company?: string; filter?: string; id?: string;
  operation: "bulk-update" | "bulk-delete"; update?: string;
}, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    const affected = await explorer.bulkWrite(actor, { ...input, confirmation });
    revalidatePath(`/data/${input.collection}`);
    return affected;
  });
}

export async function revealFieldAction(collection: string, id: string, path: string) {
  const actor = await requireOwner();
  return runAction(() => explorer.revealField(actor, collection, id, path));
}

// ---------- Oria-wide settings ----------

export async function gatewayCreditsAction() {
  await requireOwner();
  return runAction(() => oria.getGatewayCredits());
}

export async function replaceGatewayKeyAction(apiKey: string, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    const credits = await oria.replaceGatewayKey(actor, apiKey, confirmation);
    revalidatePath("/settings");
    return credits;
  }, "Chave do AI Gateway substituída.");
}

// ---------- clinics ----------

export async function createCompanyAction(input: Record<string, unknown>) {
  const actor = await requireOwner();
  return runAction(async () => {
    const id = await companies.createCompany(actor, input);
    revalidatePath("/companies");
    return id;
  }, "Clínica criada.");
}

async function companyMutation(companyId: string, message: string, body: (actor: string) => Promise<unknown>) {
  const actor = await requireOwner();
  return runAction(async () => {
    await body(actor);
    revalidatePath(`/companies/${companyId}`);
    revalidatePath("/companies");
  }, message);
}

export async function updateCompanyAction(companyId: string, input: Record<string, unknown>, confirmation?: string) {
  return companyMutation(companyId, "Clínica atualizada.", (actor) => companies.updateCompany(actor, companyId, input, confirmation));
}

export async function createUserAction(companyId: string, input: Record<string, unknown>, confirmation?: string) {
  return companyMutation(companyId, "Usuário criado.", (actor) => companies.createUser(actor, companyId, input, confirmation));
}

export async function updateUserAction(companyId: string, userId: string, input: Record<string, unknown>, confirmation?: string) {
  return companyMutation(companyId, "Usuário atualizado. As sessões dele foram encerradas.",
    (actor) => companies.updateUser(actor, companyId, userId, input, confirmation));
}

export async function setCompanyAdminAction(companyId: string, userId: string, confirmation?: string) {
  return companyMutation(companyId, "Administrador alterado.", (actor) => companies.setCompanyAdmin(actor, companyId, userId, confirmation));
}

export async function addWhatsAppConnectionAction(companyId: string, input: Record<string, unknown>, confirmation?: string) {
  return companyMutation(companyId, "Número adicionado.", (actor) => companies.addWhatsAppConnection(actor, companyId, input, confirmation));
}

export async function setConnectionStatusAction(
  companyId: string, connectionId: string, status: "operational" | "connected" | "disconnected", confirmation?: string,
) {
  return companyMutation(companyId, "Status do número atualizado.",
    (actor) => companies.setConnectionStatus(actor, companyId, connectionId, status, confirmation));
}

export async function saveAiConfigAction(companyId: string, json: string, confirmation?: string) {
  return companyMutation(companyId, "Configuração de IA salva.", (actor) => companies.saveAiConfig(actor, companyId, json, confirmation));
}

export async function previewCompanyDeletionAction(companyId: string) {
  await requireOwner();
  return runAction(() => companies.previewCompanyDeletion(companyId));
}

export async function deleteCompanyAction(companyId: string, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    const deleted = await companies.deleteCompany(actor, companyId, confirmation);
    revalidatePath("/companies");
    revalidatePath("/");
    return deleted;
  }, "Clínica excluída.");
}

export async function copyAiConfigAction(sourceId: string, targetIds: string[], confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    const copied = await companies.copyAiConfig(actor, sourceId, targetIds, confirmation);
    revalidatePath("/companies", "layout");
    return copied;
  });
}

// ---------- history cleanup ----------

export async function previewCleanupAction(scope: cleanup.CleanupScope) {
  await requireOwner();
  return runAction(() => cleanup.previewCleanup(scope));
}

export async function runCleanupAction(target: cleanup.CleanupTarget, scope: cleanup.CleanupScope, confirmation?: string) {
  const actor = await requireOwner();
  return runAction(async () => {
    const result = await cleanup.runCleanup(actor, target, scope, confirmation);
    revalidatePath("/");
    revalidatePath("/data");
    return result;
  });
}
