export function getBrowserId(prefix = ""): string {
  const randomUUIDFn =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
      : null;

  const rawId = randomUUIDFn
    ? randomUUIDFn()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return prefix ? `${prefix}${rawId}` : rawId;
}
