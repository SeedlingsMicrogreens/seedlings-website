"use client";

import { useState } from "react";
import type { CustomerAddress } from "@/lib/customerAccount";
import AddressCard from "./AddressCard";

type Props = {
  addresses: CustomerAddress[];
  selectedId?: string;
  onSelect: (address: CustomerAddress) => void;
  onEdit: (address: CustomerAddress) => void;
  onAdd: () => void;
};

export default function AddressList({
  addresses,
  selectedId,
  onSelect,
  onEdit,
  onAdd,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const visibleAddresses = showAll ? addresses : addresses.slice(0, 3);
  const hasMore = addresses.length > 3;

  return (
    <section className="checkout-address-list" aria-label="Delivery addresses">
      <h3 className="checkout-address-list__title">
        Delivery addresses ({addresses.length})
      </h3>

      <div className="checkout-address-list__items">
        {visibleAddresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            selected={address.id === selectedId}
            onSelect={() => onSelect(address)}
            onEdit={() => onEdit(address)}
          />
        ))}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="checkout-address-list__show-more"
          aria-expanded={showAll}
        >
          <span>{showAll ? "Show fewer addresses" : "Show more addresses"}</span>
          <span
            aria-hidden="true"
            className={`checkout-address-list__chevron${showAll ? " is-open" : ""}`}
          >
            ↓
          </span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={onAdd}
        className="checkout-address-list__add"
      >
        Add a new delivery address
      </button>
    </section>
  );
}
