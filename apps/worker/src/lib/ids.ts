function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomKey(prefix: string, bytes = 20): string {
  return `${prefix}${randomHex(bytes)}`;
}

export function newId(): string {
  return crypto.randomUUID();
}
