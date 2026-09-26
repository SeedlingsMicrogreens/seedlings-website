# Seedlings Microgreens — Customer Website

## Purpose
Customer-facing Next.js website for the Seedlings Microgreens platform. The site covers catalogue/microgreen browsing, product detail, cart, checkout, orders, subscriptions, delivery calendar, account/profile, addresses and enquiries.

## Current source
The supplied Phase 31 repository is the source of truth for the implementation. Before changing established behavior, check `CURRENT-STATE.md` and `DEVELOPMENT-RULES.md`, then inspect the actual code.

## Stack
- Next.js 16.3.4
- React 19.1.0
- TypeScript
- Firebase Web SDK / Firestore
- Firebase Authentication
- Firebase Admin SDK for server-side Next.js operations
- SweetAlert2
- Tailwind CSS is present in the project

## Run
```bash
npm install
npm run dev
```

Other useful scripts:
```bash
npm run build
npm run start
npm run typecheck
npm run test:e2e
npm run test:payment:static
```

## Documentation
- `SYSTEM-INTEGRATION.md` — Admin ↔ Website data, API/service and Firestore integration contract.
- `CURRENT-STATE.md` — authoritative current behavior and architecture snapshot.
- `DEVELOPMENT-RULES.md` — permanent non-regression rules.
- `DEVELOPMENT-ROADMAP.md` — work that is planned or still needs explicit decisions.
- `CHANGELOG.md` — important completed decisions and fixes.
- `UX-STANDARDS.md` — consolidated Website standardization and UX rules.

Do not create a new phase/bugfix Markdown file for every change. Update the appropriate document above.
