import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(here, "..", "src", "lib", "crypto.ts"), "utf8");

const stripped = source
  .replace(/^export /gm, "")
  .replace(/: Promise<CryptoKey>/g, "")
  .replace(/: Promise<string>/g, "")
  .replace(/: Promise<void>/g, "")
  .replace(/\bkey: CryptoKey \| string\b/g, "key")
  .replace(/\bplain: string\b/g, "plain")
  .replace(/\bcipher: string\b/g, "cipher")
  .replace(/\bmasterKey: string\b/g, "masterKey")
  .replace(/\btext: string\b/g, "text")
  .replace(/\ba: string, b: string\b/g, "a, b")
  .replace(/\binfo: string\b/g, "info")
  .replace(/bytes: Uint8Array/g, "bytes")
  .replace(/value: string/g, "value")
  .replace(/\): string \{/g, ") {")
  .replace(/\): Uint8Array \{/g, ") {")
  .replace(/\): boolean \{/g, ") {")
  .replace(/ as \[string, string\]/g, "")
  .replace(/\]!/g, "]");

const factory = new Function(
  `${stripped}; return { deriveKey, encrypt, decrypt, sha256Hex, timingSafeEqualStr };`
);
const { deriveKey, encrypt, decrypt, sha256Hex, timingSafeEqualStr } = factory();

const MASTER = "dev-only-encryption-key-0123456789";

let passed = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok  ${name}`);
};

const plaintext = "secret-jwt-token-测试-🔐";
const cipher = await encrypt(plaintext, MASTER, "credentials");
check("cipher uses enc:v1 prefix", cipher.startsWith("enc:v1:"));
check("round-trip decrypt", (await decrypt(cipher, MASTER, "credentials")) === plaintext);

const cipher2 = await encrypt(plaintext, MASTER, "credentials");
check("random IV => different ciphertext", cipher !== cipher2);
check("second decrypt", (await decrypt(cipher2, MASTER, "credentials")) === plaintext);

await assert.rejects(() => decrypt("plain:oops", MASTER, "credentials"), /plaintext/);
check("plain: prefix rejected", true);

const credKey = await deriveKey(MASTER, "credentials");
const upKey = await deriveKey(MASTER, "upstreams");
await assert.rejects(() => decrypt(cipher, upKey, "irrelevant"));
check("deriveKey purposes differ", true);
check("decrypt with CryptoKey works", (await decrypt(cipher, credKey, "irrelevant")) === plaintext);

const h1 = await sha256Hex("dwb-abc");
const h2 = await sha256Hex("dwb-abc");
const h3 = await sha256Hex("dwb-abd");
check("sha256Hex stable", h1 === h2 && h1.length === 64);
check("sha256Hex differs by input", h1 !== h3);

check("timingSafeEqualStr equal", timingSafeEqualStr("abc", "abc") === true);
check("timingSafeEqualStr diff length", timingSafeEqualStr("abc", "abcd") === false);

console.log(`\nselftest-crypto: ${passed} checks passed`);
