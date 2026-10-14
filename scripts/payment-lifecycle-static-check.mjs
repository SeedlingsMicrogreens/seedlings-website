import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
function listSources(dirs) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(rel);
    }
  };
  dirs.forEach(walk);
  return out;
}

const checks = [
  ['one-time checkout binds authUid', read('lib/customerMixedCheckout.ts'), /oneOrderWrites[\s\S]*data:\{authUid,/],
  ['availability treats successful payment state as committed', read('lib/customerAvailabilityMath.ts'), /function isPaymentCommitted[\s\S]*paymentStatus[\s\S]*paid/],
  ['availability accepts confirmed one-time orders as compatibility fallback', read('lib/customerAvailabilityMath.ts'), /type === 'subscription'\s*\?\s*status === 'active'\s*:\s*\[[^\]]*'confirmed'/],
  ['availability accepts active subscriptions as compatibility fallback', read('lib/customerAvailabilityMath.ts'), /type === 'subscription'\s*\?\s*status === 'active'/],
  ['Cashfree creation validates ownership with the shared rule', read('lib/server/cashfreeCreateOrder.ts'), /assertRecordsOwned\(firestoreOwnershipStore\(db\), caller, orders/],
  ['verification checks ownership before any (cached) result', read('lib/server/cashfreePayment.ts'), /if \(caller\) \{\s*await assertRecordsOwned[\s\S]*db\.runTransaction/],
  ['checkout claims use the shared ownership rule', read('lib/server/checkoutClaims.ts'), /resolveCustomerIdentity\([\s\S]*isRecordOwned\(/],
  ['cart checkout claims before writing and registers after', read('lib/customerMixedCheckout.ts'), /beginCheckoutClaim\([\s\S]*claim\.action==='resume'[\s\S]*writeBatch\(db\)[\s\S]*registerCheckoutClaim\(/],
  ['subscription checkout claims before writing and registers after', read('lib/customerSubscriptions.ts'), /beginCheckoutClaim\([\s\S]*claim\.action === 'resume'[\s\S]*writeBatch\(db\)[\s\S]*registerCheckoutClaim\(/],
  ['payment session checks earlier Cashfree orders before creating a new one', read('lib/server/cashfreeCreateOrder.ts'), /preparePreviousGatewayOrders\(orders, gateway, \{ freshAttempt \}\)[\s\S]*deps\.cashfreeRequest<CashfreeCreateOrderResponse>\('\/pg\/orders'/],
  ['payment creation locks every requested order in one transaction', read('lib/server/cashfreeCreateOrder.ts'), /const lockRefs = snapshots\.map\([\s\S]*runTransaction[\s\S]*lockRefs\.map\(\(ref\) => tx\.get\(ref\)\)/],
  ['creation leases are server-owned order fields and customers cannot create or mutate them', read('firestore.rules'), /allow create:[\s\S]*request\.resource\.data\.keys\(\)\.hasAny\(\['paymentCreationLock'\]\)[\s\S]*allow update:[\s\S]*request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['paymentCreationLock'\]\)/],
  ['payment creation does not create or read order-keyed attempt metadata documents', read('lib/server/cashfreeCreateOrder.ts') + read('lib/server/paymentRecords.ts'), /^(?![\s\S]*paymentAttempts\/order__)[\s\S]*$/],
  ['creation intent and price verification are stored on the gateway attempt', read('lib/server/cashfreeCreateOrder.ts'), /status: 'creating'[\s\S]*attemptData\.priceVerification = priceVerification[\s\S]*tx\.set\(attemptRef, attemptData/],
  ['Website pay actions request a fresh Cashfree attempt', read('lib/cashfreeFunctions.ts'), /options\.freshAttempt === false \? \{\} : \{ freshAttempt: true \}/],
  ['a definitive Cashfree create rejection releases the lock instead of blocking', read('lib/server/cashfreeCreateOrder.ts'), /isDefinitiveCashfreeRejection\(error\)[\s\S]*markCreationFailed[\s\S]*releaseLock\(\)/],
  ['late pending/failed results of a replaced attempt do not overwrite the order', read('lib/server/cashfreePayment.ts'), /isReplacedAttempt[\s\S]*!superseded && !replacedAttempt/],
  ['cart-change replacement refuses when a payment is in progress', read('lib/server/checkoutClaims.ts'), /getPayments[\s\S]*isUnresolvedPaymentStatus[\s\S]*still being processed/],
  ['Cashfree order intent and stable idempotency key persist before provider creation', read('lib/server/cashfreeCreateOrder.ts'), /status: 'creating'[\s\S]*idempotencyKey[\s\S]*deps\.cashfreeRequest<CashfreeCreateOrderResponse>\('\/pg\/orders'[\s\S]*\}, idempotencyKey\)/],
  ['ambiguous Cashfree order creation recovers using its original idempotency key', read('lib/server/cashfreeCreateOrder.ts'), /recoverIntent[\s\S]*intent\.idempotencyKey/],
  ['processing or unknown Cashfree payments block attempt replacement', read('lib/server/cashfreeCreateOrder.ts'), /paymentResult !== 'failed' \|\| attempted\.some\(isUnresolvedPaymentStatus\)[\s\S]*STILL_RECONCILING/],
  ['pending payment polls do not create transaction-history rows', read('lib/server/cashfreePayment.ts'), /if \(status !== 'pending'\) \{[\s\S]*batch\.set\(db\.collection\(PAYMENT_TRANSACTIONS\)/],
  ['Cashfree creation verifies server-authoritative totals first', read('lib/server/cashfreeCreateOrder.ts'), /verifyTotals: \(db, orderIds, orders, store\) => verifyCheckoutTotals\([\s\S]*await deps\.verifyTotals\([\s\S]*const total = Number\(orders\.reduce[\s\S]*deps\.cashfreeRequest/],
  ['Cashfree finalization lock lives on the attempt record and is written whole', read('lib/server/cashfreePayment.ts'), /attemptRef = db\.collection\(PAYMENT_ATTEMPTS\)[\s\S]*finalization: \{ status: 'processing'[\s\S]*mergeFields/],
  ['the Contact page never replaces a restored customer session with an anonymous one', read('components/pages/ContactPage.tsx'), /await auth\.authStateReady\(\);\s*\n\s*if \(mayStartGuestSession\(auth\.currentUser, getStoredCustomerMobile\(\)\)\) await signInAnonymously\(auth\)/],
  ['signInAnonymously is used only by the Contact page', listSources(['app', 'components', 'lib']).filter((file) => /signInAnonymously\(/.test(read(file))).join(','), /^components\/pages\/ContactPage\.tsx$/],
  ['an orphaned guest session is signed out on every page', read('app/layout.tsx'), /<CustomerSessionGuard \/>/],
  ['checkout claim and payment routes refuse anonymous sessions', ['app/api/customer/checkout-claim/route.ts', 'app/api/cashfree/create-payment-session/route.ts', 'app/api/cashfree/verify-payment/route.ts'].map(read).join('\n'), /^(?![\s\S]*requireFirebaseUser)[\s\S]*requireCustomerCaller[\s\S]*requireCustomerCaller[\s\S]*requireCustomerCaller/],
  ['the claim route passes the verified token claim, not the request mobile, as identity', read('app/api/customer/checkout-claim/route.ts'), /verifiedCustomerId: user\.customerId[\s\S]*verifiedCustomerId: user\.customerId/],
  ['the header decides "signed in" from the resolved Firebase session, not the remembered mobile', read('components/layout/Header.tsx'), /const session = await getCustomerSession\(\);[\s\S]*if \(currentRequest !== requestId \|\| !session\.signedIn\) return;/],
  ['checkout decides "signed in" from the resolved Firebase session and replaces its content when signed out', read('components/CheckoutHydrator.tsx'), /session = await getCustomerSession\(\);[\s\S]*if \(!session\.signedIn\) return renderSignedOut\(\);[\s\S]*/],
  ['checkout signed-out view replaces the checkout', read('components/CheckoutHydrator.tsx'), /const renderSignedOut = \(\) => \{\s*\n\s*root\.innerHTML = /],
  ['claim and payment API calls use the customer token helper (restoration, no guests, refresh on 401)', read('lib/checkoutClaimClient.ts') + read('lib/cashfreeFunctions.ts'), /fetchWithCustomerToken\(auth[\s\S]*fetchWithCustomerToken\(auth/],
  ['the session guard decides only after restoration', read('components/CustomerSessionGuard.tsx'), /shouldSignOutOrphanedGuest\(auth, getStoredCustomerMobile\)/],
  ['automatic login prompts go through the single prompt helper', ['components/CheckoutHydrator.tsx', 'components/AccountHydrator.tsx', 'lib/cashfreeFunctions.ts'].map(read).join('\n'), /requestLogin\('checkout', 'session_absent'\)[\s\S]*requestLogin\("account", "session_absent"[\s\S]*requestLogin\('payment-api', 'api_unauthenticated'\)/],
  ['the Account panel clears customer state and signs out only when it shows the customer signed in', read('components/AuthHydrator.tsx'), /if \(signedInShown\) \{\s*\n\s*clearCustomerBrowserSessionState\(\);\s*\n\s*await signOut\(auth\)/],
  ['an unrecoverable pending payment record is discarded, not re-verified forever', read('components/PaymentRecoveryHydrator.tsx'), /discardUnknownPendingCashfreePayment\(error, pending\.cashfreeOrderId\)/],
  ['Firebase emulator connection is opt-in (both emulator variables required)', read('lib/firebase.ts'), /if \(authEmulatorHost && firestoreEmulatorHost && /],
  ['no application code references a retired payment collection', listSources(['app', 'components', 'lib']).map(read).join('\n'), /^(?![\s\S]*\b(paymentCreationLocks|paymentFinalizationLocks|orderPriceVerifications)\b)[\s\S]*$/],
  ['payment state is stored in exactly two payment collections', read('lib/server/paymentRecords.ts'), /PAYMENT_ATTEMPTS = 'paymentAttempts'[\s\S]*PAYMENT_TRANSACTIONS = 'paymentTransactions'/],
  ['only the create-payment-session, verify-payment and webhook Cashfree routes exist', fs.readdirSync(path.join(root, 'app/api/cashfree')).sort().join(','), /^create-payment-session,verify-payment,webhook$/],
  ['no Firebase Functions payment project remains', fs.existsSync(path.join(root, 'functions')) ? 'present' : 'absent', /^absent$/],
  ['firestore rules have no blocks for retired payment collections', read('firestore.rules'), /^(?![\s\S]*(paymentCreationLocks|paymentFinalizationLocks|orderPriceVerifications))[\s\S]*$/],
  ['a paid finalization records the attempt that paid', read('lib/server/cashfreePayment.ts'), /orderUpdate\.paidCashfreeOrderId = cashfreeOrderId/],
  ['Cashfree webhook exists', fs.existsSync(path.join(root, 'app/api/cashfree/webhook/route.ts')) ? 'yes' : '', /yes/],
  ['paymentAttempts are recorded', read('lib/server/cashfreeCreateOrder.ts'), /paymentAttempts/],
  ['paid state cannot be downgraded', read('lib/server/cashfreePayment.ts'), /alreadyPaid.*status !== 'paid'/s],
  ['security rules protect payment collections', read('firestore.rules'), /match \/paymentTransactions\/\{id\}[\s\S]*allow read, write: if false;/],
  ['pending finalization can be retried', read('lib/server/cashfreePayment.ts'), /status === 'pending' \? 'pending' : 'completed'/],
  ['Cashfree order registers webhook URL', read('lib/server/cashfreeCreateOrder.ts'), /notify_url: webhookUrl/],
  ['pending webhook is acknowledged after server processing', read('app/api/cashfree/webhook/route.ts'), /return NextResponse\.json\(\{ received: true, status: result\.status \}, \{ status: 200 \}\)/],
  ['persistent payment recovery is wired and scoped to its attempt', read('components/PaymentRecoveryHydrator.tsx'), /completeCashfreePayment[\s\S]*settleCashfreeOutcome\(\{ status: result\.status, cashfreeOrderId: pending\.cashfreeOrderId/],
  ['no payment page clears the cart or pending record unconditionally', ['components/PaymentRecoveryHydrator.tsx', 'components/CashfreeReturnHydrator.tsx', 'components/OrderDetailHydrator.tsx'].map(read).join('\n'), /^(?![\s\S]*(clearCart\(\)|clearPendingCashfreePayment\(\)))[\s\S]*$/],
  ['return-page retry uses the returned attempt orders, not the latest saved checkout', read('components/CashfreeReturnHydrator.tsx'), /retryReturnedAttempt\(result\)/],
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
