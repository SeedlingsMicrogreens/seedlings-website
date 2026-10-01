import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [
  ['one-time checkout binds authUid', read('lib/customerMixedCheckout.ts'), /oneOrderWrites[\s\S]*data:\{authUid,/],
  ['availability treats successful payment state as committed', read('lib/customerOrderAvailability.ts'), /function isPaymentCommitted[\s\S]*paymentStatus[\s\S]*paid/],
  ['availability accepts confirmed one-time orders as compatibility fallback', read('lib/customerOrderAvailability.ts'), /type === 'one-time' \? status === 'confirmed'/],
  ['availability accepts active subscriptions as compatibility fallback', read('lib/customerOrderAvailability.ts'), /type === 'one-time' \? status === 'confirmed'\s*:\s*status === 'active'/],
  ['Cashfree creation validates authUid', read('lib/server/cashfreeCreateOrder.ts'), /order\.authUid.*uid/],
  ['Cashfree finalization has a finalization lock', read('lib/server/cashfreePayment.ts'), /paymentFinalizationLocks/],
  ['Cashfree webhook exists', fs.existsSync(path.join(root, 'app/api/cashfree/webhook/route.ts')) ? 'yes' : '', /yes/],
  ['paymentAttempts are recorded', read('lib/server/cashfreeCreateOrder.ts'), /paymentAttempts/],
  ['paid state cannot be downgraded', read('lib/server/cashfreePayment.ts'), /alreadyPaid.*status !== 'paid'/s],
  ['security rules protect payment collections', read('firestore.rules'), /match \/paymentTransactions\/\{id\}[\s\S]*allow read, write: if false;/],
  ['pending finalization can be retried', read('lib/server/cashfreePayment.ts'), /status === 'pending' \? 'pending' : 'completed'/],
  ['Cashfree order registers webhook URL', read('lib/server/cashfreeCreateOrder.ts'), /notify_url: webhookUrl/],
  ['pending webhook is acknowledged after server processing', read('app/api/cashfree/webhook/route.ts'), /return NextResponse\.json\(\{ received: true, status: result\.status \}, \{ status: 200 \}\)/],
  ['persistent payment recovery is wired', read('components/PaymentRecoveryHydrator.tsx'), /completeCashfreePayment[\s\S]*clearCart/],
  ['checkout displays paise precision', read('components/CheckoutHydrator.tsx'), /minimumFractionDigits: 2, maximumFractionDigits: 2/],
  ['subscription uses full-quantity delivery resolution', read('lib/customerSubscriptions.ts'), /resolveProductDeliveryDate[\s\S]*kind: 'subscription'/],
];
let failed = 0;
for (const [name, content, pattern] of checks) {
  const ok = pattern.test(content);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`\nPayment lifecycle static gate passed: ${checks.length} checks.`);
