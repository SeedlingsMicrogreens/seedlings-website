import assert from "node:assert/strict";
import test from "node:test";
import { isFeedbackRatingValid, toggleFeedbackOption } from "../../lib/orderFeedback.ts";

test("feedback requires both ratings to be between one and five", () => {
  assert.equal(isFeedbackRatingValid(1, 1), true);
  assert.equal(isFeedbackRatingValid(5, 5), true);
  assert.equal(isFeedbackRatingValid(0, 5), false);
  assert.equal(isFeedbackRatingValid(5, 0), false);
  assert.equal(isFeedbackRatingValid(6, 4), false);
});

test("feedback options can be selected and deselected without changing other selections", () => {
  assert.deepEqual(toggleFeedbackOption([], "freshness"), ["freshness"]);
  assert.deepEqual(toggleFeedbackOption(["freshness", "packaging"], "freshness"), ["packaging"]);
});
