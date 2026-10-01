const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const ENC_PREFIX = "enc:v1:";

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKey(masterKey: string, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterKey),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("drawing-workbench"), info: encoder.encode(info) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function resolveKey(key: CryptoKey | string, info: string): Promise<CryptoKey> {
  return typeof key === "string" ? deriveKey(key, info) : key;
}

export async function encrypt(
  plain: string,
  key: CryptoKey | string,
  info: string
): Promise<string> {
  const cryptoKey = await resolveKey(key, info);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoder.encode(plain))
  );
  return `${ENC_PREFIX}${toB64(iv)}:${toB64(ct)}`;
}

export async function decrypt(
  cipher: string,
  key: CryptoKey | string,
  info: string
): Promise<string> {
  if (cipher.startsWith("plain:")) throw new Error("plaintext_credentials_rejected");
  if (!cipher.startsWith(ENC_PREFIX)) throw new Error("invalid_ciphertext");
  const parts = cipher.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 2) throw new Error("invalid_ciphertext");
  const [ivB64, ctB64] = parts as [string, string];
  const cryptoKey = await resolveKey(key, info);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    cryptoKey,
    fromB64(ctB64)
  );
  return decoder.decode(pt);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const la = encoder.encode(a);
  const lb = encoder.encode(b);
  if (la.length !== lb.length) return false;
  let diff = 0;
  for (let i = 0; i < la.length; i++) diff |= la[i]! ^ lb[i]!;
  return diff === 0;
}
