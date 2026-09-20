# Seedlings Firebase Functions

Cashfree payment backend for the Seedlings Customer Website.

## Functions

- `createCashfreeOrderFunction` — authenticated callable function that validates existing pending orders and creates one Cashfree Hosted Checkout session.
- `completeCashfreePayment` — authenticated callable function that verifies the Cashfree order/payment and finalizes existing Seedlings orders/subscriptions.
- `cashfreeWebhook` — HTTPS webhook endpoint for Cashfree server-to-server payment notifications.

The functions use Firebase Admin SDK only inside the trusted Firebase Functions runtime. The Website does not run `firebase-admin` and does not contain Cashfree secrets.

## Secret configuration

Create one Firebase Secret Manager secret containing JSON:

```json
{
  "clientId": "YOUR_CASHFREE_SANDBOX_APP_ID",
  "clientSecret": "YOUR_CASHFREE_SANDBOX_SECRET_KEY",
  "webhookSecret": "YOUR_CASHFREE_WEBHOOK_SECRET",
  "environment": "sandbox",
  "apiVersion": "2025-01-01",
  "siteUrl": "https://YOUR-WEBSITE-DOMAIN"
}
```

Set it with:

```bash
firebase functions:secrets:set CASHFREE_CONFIG
```

For local emulator testing, Firebase Functions Secret Manager values can be supplied through the supported local secret configuration. Do not commit the secret value.

## Deploy

From the website root:

```bash
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

After deployment, configure the Cashfree webhook URL to the deployed `cashfreeWebhook` HTTPS endpoint.

## Local testing

The Firebase Functions emulator can run callable and HTTPS functions locally. Cashfree itself cannot call a localhost webhook, so browser-return verification is used during local sandbox testing; the deployed webhook is used for server-to-server notifications.
