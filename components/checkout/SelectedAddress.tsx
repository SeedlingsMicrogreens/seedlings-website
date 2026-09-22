"use client";

import type { CustomerAddress } from "@/lib/customerAccount";

type Props = {
  address: CustomerAddress;
  onChange: () => void;
};

const addressText = (a: CustomerAddress) =>
  [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode]
    .map(v => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");

export default function SelectedAddress({ address, onChange }: Props) {
  const name = address.name || "you";
  const lines = addressText(address);

  return (
    <section className="checkout-selected-address" aria-label="Selected delivery address">
      <div className="checkout-selected-address__row">
        <div className="checkout-selected-address__content">
          <p className="checkout-selected-address__title">
            Delivering to {name}
          </p>
          <p className="checkout-selected-address__address">{lines}</p>
        </div>

        <button
          type="button"
          onClick={onChange}
          className="checkout-selected-address__change"
        >
          Change
        </button>
      </div>
    </section>
  );
}
