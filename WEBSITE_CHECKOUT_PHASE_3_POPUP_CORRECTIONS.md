# Checkout Phase 3 — Popup Corrections

Corrections based on the verified screenshot:

1. Removed the duplicate `Edit delivery address` title.
2. The modal now has exactly one visible title.
3. The visible title is also the dialog's accessible `aria-labelledby` target.
4. The address popup remains fixed to the viewport.
5. Header/Footer are explicitly layered below the fixed modal; their existing
   visual design is unchanged.
6. Modal backdrop cannot scroll; only the modal panel scrolls when necessary.

No address save/edit business logic was changed.
No Delivery Instructions were added.
