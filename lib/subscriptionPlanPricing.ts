export type SubscriptionSellingOptionPrice = {
  id: string;
  weightGrams: number;
  planPrice: number;
  maximumPlanPrice?: number;
};

export type SubscriptionPlanPriceSource = {
  price?: number;
  sellingOptions?: SubscriptionSellingOptionPrice[];
};

export function getSubscriptionSellingOptions(
  plan: SubscriptionPlanPriceSource,
): SubscriptionSellingOptionPrice[] {
  return (Array.isArray(plan.sellingOptions) ? plan.sellingOptions : [])
    .filter((option) => Number(option?.weightGrams) > 0 && Number(option?.planPrice) >= 0)
    .map((option) => ({
      ...option,
      weightGrams: Number(option.weightGrams),
      planPrice: Number(option.planPrice),
      maximumPlanPrice:
        typeof option.maximumPlanPrice === "number" && Number.isFinite(option.maximumPlanPrice)
          ? option.maximumPlanPrice
          : undefined,
    }));
}

export function resolveSubscriptionPlanPrices(
  plan: SubscriptionPlanPriceSource,
  selection: { sellingOptionId?: string; packaging?: number },
) {
  const options = getSubscriptionSellingOptions(plan);
  const option = selection.packaging !== undefined
    ? options.find((item) => item.weightGrams === selection.packaging)
    : options.find((item) => item.id === selection.sellingOptionId);
  const price = Number(option?.planPrice ?? plan.price ?? 0);
  const maximumPlanPrice =
    option?.maximumPlanPrice !== undefined && option.maximumPlanPrice > price
      ? option.maximumPlanPrice
      : undefined;

  return { option, price, maximumPlanPrice };
}
