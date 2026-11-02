import { BSON } from "mongodb";
import { ConfirmationRequired } from "./risk";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; confirm?: string };

/** Runs a server action body and turns errors into a serializable result the UI can show. */
export async function runAction<T>(body: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body(), message };
  } catch (error) {
    if (error instanceof ConfirmationRequired) return { ok: false, error: error.message, confirm: error.phrase };
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    if (error && typeof error === "object" && "digest" in error) throw error;
    const mongoDuplicate = error instanceof Error && "code" in error && (error as { code?: number }).code === 11000;
    return {
      ok: false,
      error: mongoDuplicate ? "Já existe um registro com estes valores únicos (por exemplo, o mesmo e-mail)."
        : error instanceof Error ? error.message : "Erro inesperado.",
    };
  }
}

/** Extended JSON keeps ObjectId and Date types when documents go to the browser and back. */
export function toEjson(value: unknown, pretty = true) {
  return BSON.EJSON.stringify(value, { relaxed: true }, pretty ? 2 : undefined);
}

export function parseEjson(text: string, label = "JSON"): unknown {
  try {
    return BSON.EJSON.parse(text, { relaxed: false });
  } catch (error) {
    throw new Error(`${label} inválido: ${error instanceof Error ? error.message : "erro de sintaxe"}`);
  }
}

export function parseEjsonObject(text: string, label = "JSON"): Record<string, unknown> {
  const value = text.trim() ? parseEjson(text, label) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  return value as Record<string, unknown>;
}
