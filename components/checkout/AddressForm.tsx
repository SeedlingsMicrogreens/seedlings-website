"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CustomerAddress } from "@/lib/customerAccount";

type Props = {
  initialAddress?: CustomerAddress | null;
  defaultName?: string;
  defaultMobile?: string;
  onSave: (address: CustomerAddress) => Promise<void>;
  onCancel?: () => void;
  mode: "add" | "edit";
  inline?: boolean;
};

const addressText = (a: CustomerAddress) =>
  [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode]
    .map(v => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");

export default function AddressForm({
  initialAddress,
  defaultName = "",
  defaultMobile = "",
  onSave,
  onCancel,
  mode,
  inline = false,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (inline) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onCancel && !saving) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [inline, onCancel, saving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    ) as Record<string, string>;

    const mobile = String(body.mobileNumber || "").replace(/\D/g, "");
    const pincode = String(body.pincode || "").replace(/\D/g, "");
    const name = String(body.name || "").trim();
    const addressLine1 = String(body.addressLine1 || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim();

    if (!/^\d{10}$/.test(mobile)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }

    if (
      !name ||
      !addressLine1 ||
      !city ||
      !state ||
      !/^\d{6}$/.test(pincode)
    ) {
      setError("Please complete all required address fields.");
      return;
    }

    const next: CustomerAddress = {
      id: initialAddress?.id || crypto.randomUUID(),
      label: String(body.label || "Home"),
      name,
      mobileNumber: mobile,
      addressLine1,
      addressLine2: String(body.addressLine2 || "").trim() || undefined,
      landmark: String(body.landmark || "").trim() || undefined,
      city,
      state,
      pincode,
    };

    setSaving(true);
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save address.");
      setSaving(false);
    }
  }

  const title = mode === "edit" ? "Edit delivery address" : "Add a new delivery address";

  const formContent = (
    <form onSubmit={submit} className={inline ? "checkout-address-form" : "checkout-address-form checkout-address-form--modal"}>
      <div className="checkout-address-form__header">
        <h3 id="checkout-address-dialog-title">{title}</h3>
        {onCancel && (
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            disabled={saving}
            className="checkout-address-form__close"
          >
            ×
          </button>
        )}
      </div>

      <div className="checkout-address-form__body">
        <div className="checkout-address-form__fields">
        <label>
          <span>Country/Region</span>
          <select name="country" defaultValue="India">
            <option value="India">India</option>
          </select>
        </label>

        <label>
          <span>Full name</span>
          <input
            name="name"
            defaultValue={initialAddress?.name || defaultName}
            required
            autoComplete="name"
          />
        </label>

        <label>
          <span>Mobile number</span>
          <input
            name="mobileNumber"
            defaultValue={initialAddress?.mobileNumber || defaultMobile}
            inputMode="numeric"
            maxLength={10}
            required
            autoComplete="tel"
          />
        </label>

        <label>
          <span>Pincode</span>
          <input
            name="pincode"
            defaultValue={initialAddress?.pincode || ""}
            inputMode="numeric"
            maxLength={6}
            required
            autoComplete="postal-code"
          />
        </label>

        <label className="checkout-address-form__full">
          <span>Flat, House no., Building, Company, Apartment</span>
          <input
            name="addressLine1"
            defaultValue={initialAddress?.addressLine1 || ""}
            required
            autoComplete="address-line1"
          />
        </label>

        <label className="checkout-address-form__full">
          <span>Area, Street, Sector, Village</span>
          <input
            name="addressLine2"
            defaultValue={initialAddress?.addressLine2 || ""}
            autoComplete="address-line2"
          />
        </label>

        <label className="checkout-address-form__full">
          <span>Landmark</span>
          <input
            name="landmark"
            defaultValue={initialAddress?.landmark || ""}
          />
        </label>

        <label>
          <span>Town/City</span>
          <input
            name="city"
            defaultValue={initialAddress?.city || ""}
            required
            autoComplete="address-level2"
          />
        </label>

        <label>
          <span>State</span>
          <input
            name="state"
            defaultValue={initialAddress?.state || ""}
            required
            autoComplete="address-level1"
          />
        </label>
        </div>

        {error && (
          <p role="alert" className="checkout-address-form__error">
            {error}
          </p>
        )}
      </div>

      <div className="checkout-address-form__actions">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="checkout-address-form__cancel"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="checkout-address-form__save"
        >
          {saving ? "Saving…" : mode === "edit" ? "Save address" : "Add address"}
        </button>
      </div>
    </form>
  );

  if (inline) {
    return <div className="checkout-address-form-inline">{formContent}</div>;
  }

  return (
    <div
      className="checkout-address-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-address-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onCancel && !saving) {
          onCancel();
        }
      }}
    >
      <div className="checkout-address-modal__panel">
        {formContent}
      </div>
    </div>
  );
}
