"use client";

import { useState } from "react";
import type { CustomerAddress } from "@/lib/customerAccount";
import AddressList from "./AddressList";
import AddressForm from "./AddressForm";
import SelectedAddress from "./SelectedAddress";

type Props = {
  addresses: CustomerAddress[];
  selectedId: string;
  customerName: string;
  mobile: string;
  onSelect: (address: CustomerAddress) => void;
  onSave: (address: CustomerAddress, mode: "add" | "edit") => Promise<void>;
};

export default function CheckoutAddressManager({
  addresses, selectedId, customerName, mobile, onSelect, onSave,
}: Props) {
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<CustomerAddress | null | undefined>(undefined);

  if (editing !== undefined || addresses.length === 0) {
    return (
      <AddressForm
        initialAddress={editing || null}
        defaultName={customerName}
        defaultMobile={mobile}
        mode={editing ? "edit" : "add"}
        inline={addresses.length === 0}
        onCancel={addresses.length ? () => setEditing(undefined) : undefined}
        onSave={async address => {
          await onSave(address, editing ? "edit" : "add");
          setEditing(undefined);
          setChoosing(false);
        }}
      />
    );
  }

  const selected = addresses.find(a => a.id === selectedId) || addresses[0];

  if (!choosing) {
    return <SelectedAddress address={selected} onChange={() => setChoosing(true)} />;
  }

  return (
    <section className="checkout-address-selector">
      <div className="flex items-center justify-between">
        
      </div>
      <AddressList
        addresses={addresses}
        selectedId={selected.id}
        onSelect={address => {
          onSelect(address);
          setChoosing(false);
        }}
        onEdit={address => setEditing(address)}
        onAdd={() => setEditing(null)}
      />
    </section>
  );
}
