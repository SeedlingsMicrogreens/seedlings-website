import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [
  ['one-time checkout binds authUid', read('lib/customerMixedCheckout.ts'), /const oneOrder=oneOrderRef\?\{authUid,/],
  ['availability treats successful payment state as committed', read('lib/customerOrderAvailability.ts'), /function isPaymentCommitted[\s\S]*paymentStatus[\s\S]*paid/],
  ['availability accepts confirmed one-time orders as compatibility fallback', read('lib/customerOrderAvailability.ts'), /type === 'one-time' \? status === 'confirmed'/],
  ['availability accepts active subscriptions as compatibility fallback', read('lib/customerOrderAvailability.ts'), /type === 'subscription' \? status === 'active'/],
  ['Cashfree creation validates authUid', read('lib/server/cashfreeCreateOrder.ts'), /order\.authUid.*uid/],
  ['Cashfree finalization has a finalization lock', read('lib/server/cashfreePayment.ts'), /paymentFinalizationLocks/],
  ['Cashfree webhook exists', fs.existsSync(path.join(root, 'app/api/cashfree/webhook/route.ts')) ? 'yes' : '', /yes/],
  ['paymentAttempts are recorded', read('lib/server/cashfreeCreateOrder.ts'), /paymentAttempts/],
  ['paid state cannot be downgraded', read('lib/server/cashfreePayment.ts'), /alreadyPaid.*status !== 'paid'/s],
  ['security rules protect payment collections', read('firestore.rules'), /match \/paymentTransactions\/\{id\}[\s\S]*allow read, write: if false;/],
];
let failed = 0;
for (const [name, content, pattern] of checks) {
  const ok = pattern.test(content);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`\nPayment lifecycle static gate passed: ${checks.length} checks.`);
