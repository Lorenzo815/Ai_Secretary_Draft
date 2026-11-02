// Hides secrets before documents leave the server, and puts them back when an edited document is saved.

export const MASK = "__masked__";
export type MaskKind = "encrypted" | "secret" | "hash";
export interface MaskInfo { path: string; kind: MaskKind; revealable: boolean }
export type MaskMarker = { [MASK]: MaskInfo };

const SECRET_KEY = /(token|secret|apikey|api_key|password)$/i;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function isEncryptedShape(value: unknown): value is { iv: string; authTag: string; ciphertext?: string; encrypted?: string } {
  return isPlainObject(value) && typeof value.iv === "string" && typeof value.authTag === "string" &&
    (typeof value.ciphertext === "string" || typeof value.encrypted === "string");
}

function classify(key: string, value: unknown): Omit<MaskInfo, "path"> | null {
  if (isEncryptedShape(value)) return { kind: "encrypted", revealable: true };
  if (key === "passwordHash") return { kind: "hash", revealable: false };
  if (typeof value === "string" && SECRET_KEY.test(key)) return { kind: "secret", revealable: true };
  return null;
}

export function isMaskMarker(value: unknown): value is MaskMarker {
  return isPlainObject(value) && Object.keys(value).length === 1 && isPlainObject(value[MASK]) &&
    typeof (value[MASK] as Record<string, unknown>).path === "string";
}

/** Deep copy with every secret replaced by a marker that records where it came from. */
export function maskDocument<T>(value: T, path = ""): T {
  if (Array.isArray(value)) return value.map((item, index) => maskDocument(item, join(path, String(index)))) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const childPath = join(path, key);
    const masked = classify(key, child);
    return [key, masked ? { [MASK]: { path: childPath, ...masked } } : maskDocument(child, childPath)];
  })) as T;
}

export function listMasks(value: unknown, found: MaskInfo[] = []): MaskInfo[] {
  if (isMaskMarker(value)) found.push(value[MASK]);
  else if (Array.isArray(value)) value.forEach((item) => listMasks(item, found));
  else if (isPlainObject(value)) Object.values(value).forEach((item) => listMasks(item, found));
  return found;
}

export function getPath(document: unknown, path: string): unknown {
  let current: unknown = document;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (isPlainObject(current)) current = current[part];
    else return undefined;
  }
  return current;
}

/** Replaces each marker in an edited document with the original secret from the stored document. */
export function restoreMasked(edited: unknown, original: unknown): unknown {
  if (isMaskMarker(edited)) {
    const value = getPath(original, edited[MASK].path);
    if (value === undefined) throw new Error(`O campo protegido "${edited[MASK].path}" não existe no documento original.`);
    return value;
  }
  if (Array.isArray(edited)) return edited.map((item) => restoreMasked(item, original));
  if (isPlainObject(edited)) {
    return Object.fromEntries(Object.entries(edited).map(([key, child]) => [key, restoreMasked(child, original)]));
  }
  return edited;
}

function join(path: string, key: string) {
  return path ? `${path}.${key}` : key;
}
