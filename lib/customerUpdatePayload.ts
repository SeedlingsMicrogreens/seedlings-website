export function sanitizeCustomerUpdatePayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeCustomerUpdatePayload(entry))
      .filter((entry) => entry !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      output[key] = sanitizeCustomerUpdatePayload(entry);
    }
    return output as T;
  }

  return value;
}
