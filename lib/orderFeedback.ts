export function isFeedbackRatingValid(orderRating: number, deliveryRating: number): boolean {
  return orderRating >= 1 && orderRating <= 5 && deliveryRating >= 1 && deliveryRating <= 5;
}

export function toggleFeedbackOption(current: string[], value: string): string[] {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}
