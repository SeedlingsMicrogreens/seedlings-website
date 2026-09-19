export type HarvestShortageMode = 'one-time' | 'subscription';

export async function confirmHarvestShortage(args: {
  mode: HarvestShortageMode;
  availableGrams: number;
  requestedGrams: number;
  shortageGrams: number;
}) {
  const { default: Swal } = await import('sweetalert2');
  const available = Math.max(0, Math.floor(args.availableGrams));
  const requested = Math.max(0, Math.floor(args.requestedGrams));
  const shortage = Math.max(0, Math.floor(args.shortageGrams));

  const isSubscription = args.mode === 'subscription';
  const message = isSubscription
    ? `Only <strong>${available} gms</strong> will be available for this delivery out of <strong>${requested} gms</strong> requested. The remaining <strong>${shortage} gms</strong> will be covered with your upcoming delivery.`
    : `Only <strong>${available} gms</strong> will be available for this delivery out of <strong>${requested} gms</strong> requested.`;

  const result = await Swal.fire({
    icon: 'warning',
    title: 'Limited harvest available',
    html: `${message}<br><br>Would you like to continue with your order?`,
    showCancelButton: true,
    confirmButtonText: 'Yes, continue',
    cancelButtonText: 'No, contact me',
    reverseButtons: true,
    focusCancel: true,
    allowOutsideClick: false,
    allowEscapeKey: false,
  });

  return result.isConfirmed ? 'continue' as const : 'contact' as const;
}

export async function showCustomerSuccess(title: string, text?: string) {
  const { default: Swal } = await import('sweetalert2');
  await Swal.fire({
    icon: 'success',
    title,
    text,
    confirmButtonText: 'OK',
  });
}

export async function confirmCustomerAddressDelete(addressLabel: string) {
  const { default: Swal } = await import('sweetalert2');
  const result = await Swal.fire({
    icon: 'warning',
    title: 'Delete address?',
    html: `Delete <strong>${String(addressLabel || 'this address').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char))}</strong>?<br><br>This action cannot be undone.`,
    showCancelButton: true,
    confirmButtonText: 'Delete address',
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    focusCancel: true,
    allowOutsideClick: false,
    allowEscapeKey: true,
  });
  return result.isConfirmed;
}
