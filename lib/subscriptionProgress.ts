export function isSubscriptionComplete(completedDeliveries: unknown, totalDeliveries: unknown) {
  const completed = Math.max(0, Math.round(Number(completedDeliveries) || 0));
  const total = Math.max(0, Math.round(Number(totalDeliveries) || 0));
  return total > 0 && completed >= total;
}
