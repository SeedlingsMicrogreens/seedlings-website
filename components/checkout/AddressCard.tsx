"use client";

import type { CustomerAddress } from "@/lib/customerAccount";

type Props = {
  address: CustomerAddress;
  selected?: boolean;
  onSelect: () => void;
  onEdit: () => void;
};

const addressText = (a: CustomerAddress) =>
  [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode]
    .map(v => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");

export default function AddressCard({ address, selected = false, onSelect, onEdit }: Props) {
  const name = address.name || address.label || "Delivery address";

  return (
    <div className={`checkout-address-item${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        aria-label={`Select ${name}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="checkout-address-item__radio"
      >
        <span aria-hidden="true" />
      </button>

      <div className="checkout-address-item__content">
        <p className="checkout-address-item__name">{name}</p>
        <p className="checkout-address-item__address">{addressText(address)}</p>

        {address.mobileNumber ? (
          <p className="checkout-address-item__phone">
            Phone number: {address.mobileNumber}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onEdit}
          className="checkout-address-item__edit"
        >
          Edit address
        </button>
      </div>
    </div>
  );
}
