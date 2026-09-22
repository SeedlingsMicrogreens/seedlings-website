# Seedlings Website — Standardization Phase 12

## Phase
`web_std_phase_12`

## Baseline
`web_std_phase_11` — latest standardization baseline.

## Scope

**Authentication**

This phase establishes the common React boundary for existing customer
authentication screens and flows.

## Objective

Standardize authentication implementation without changing:

- login UX
- signup UX
- OTP UX
- Firebase Auth behavior
- session/token behavior
- customer identity
- redirects
- protected-route behavior
- error messages
- existing authentication service contracts

## Strict rule

**Standardize the implementation, not the UX/UI.**

No authentication redesign is part of this phase.

## Added

`components/pages/AuthenticationPage.tsx`

This is a presentation-only boundary. It does not replace or alter the
existing authentication implementation.

## Authentication behavior that must remain unchanged

The existing Firebase authentication chain is protected:

`Login/OTP → Firebase Auth session → auth.currentUser → ID token → API Authorization Bearer → server-side Firebase token verification`

Do not:

- introduce Firebase Functions
- replace Firebase Auth
- change token ownership
- bypass server-side token verification
- store passwords in client-side storage
- weaken protected routes
- change customer ownership checks
- change the existing demo OTP behavior
- add production-only restrictions to the current demo OTP flow

## Migration order

1. Login screen.
2. Signup screen.
3. OTP entry/verification.
4. Authentication loading states.
5. Authentication error states.
6. Session restoration.
7. Logout.
8. Protected-route handling.
9. Redirect behavior.
10. Remove legacy DOM/prototype implementation only after equivalent
    React behavior is verified.

## UX protection

The current authentication screens are the source of truth.

No new fields, dialogs, steps, branding, validation behavior, or redirect
rules should be introduced during standardization.

## Security protection

Do not modify:

- Firebase Auth configuration.
- Firebase Admin token verification.
- Authorization headers.
- Customer UID ownership checks.
- Firestore security rules.
- Server-side authentication requirements.
- Payment authentication ownership.
- Existing session persistence behavior.

## Regression gate

Verify:

- [ ] Login works.
- [ ] Signup works.
- [ ] OTP flow works.
- [ ] Firebase Auth session is established.
- [ ] `auth.currentUser` is available after successful login.
- [ ] Auth token is sent to protected API requests.
- [ ] Protected pages remain protected.
- [ ] Logout works.
- [ ] Existing redirects remain unchanged.
- [ ] Existing error/loading states remain unchanged.
- [ ] Checkout authentication still works.
- [ ] Orders authentication still works.
- [ ] Account/Profile/Addresses authentication still works.
- [ ] No new console errors.
- [ ] Desktop UX/UI unchanged.
- [ ] Mobile UX/UI unchanged.

## Detected authentication routes

The baseline was scanned for authentication-related page routes. These are
the routes to inspect during the actual page migration:



## Important implementation rule

This ZIP does **not** claim that every authentication page has already been
fully migrated.

The actual migration must be performed page-by-page against the working
baseline, with functionality verified before proceeding to the next page.

## Git

The existing `.git` directory and Git history from Phase 11 are preserved.

## Next phase

Phase 13 — Remaining Pages.

Do not proceed until Authentication has been verified.
