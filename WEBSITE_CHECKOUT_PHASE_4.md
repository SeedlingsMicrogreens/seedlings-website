# Website Checkout Phase 4 — Exact Checkout Address UX/UI

## Scope

Phase 4 applies the provided Checkout/address reference UX to the reusable
React/Tailwind components created and integrated in Phases 2–3.

## UI rules implemented

- Selected address is visually distinguishable.
- Address content has clear hierarchy.
- `Change` remains a compact action.
- Address list has consistent cards and radio selection.
- `Edit address` remains an inline action.
- `Add a new delivery address` is a full-width secondary action.
- Address form uses the same visual language as the checkout.
- No delivery-instructions UI is introduced.
- Responsive layout is provided through the same Tailwind components.

## Protected

No changes to:

- cart
- order creation
- payment
- Cashfree
- inventory
- subscription
- delivery-charge calculation
- authentication
- customer ownership
- address persistence APIs

## Important

This phase changes presentation only. Checkout integration from Phase 3
remains the source of truth for behavior.

## Validation target

Compare the Checkout page directly with the supplied reference screenshots,
including:

- spacing
- card borders/radius
- typography hierarchy
- radio controls
- Change/Edit actions
- Add-address action
- form spacing
- mobile wrapping

Do not introduce a separate mobile implementation.
