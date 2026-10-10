export function resolveAddressRecipientName({
  submittedName,
  initialName,
  defaultName,
}: {
  submittedName?: string | null;
  initialName?: string | null;
  defaultName?: string | null;
}): string {
  const typed = String(submittedName ?? '').trim();
  if (typed) return typed;

  const saved = String(initialName ?? '').trim();
  if (saved) return saved;

  return String(defaultName ?? '').trim();
}
