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
  const message = isSubscription ? `We're experiencing high demand right now. Your order will be fulfilled, and any remaining quantity will be adjusted with your upcoming delivery.` : `We're experiencing high demand right now. Your order will be fulfilled, and any remaining quantity will be adjusted with your upcoming delivery.`;

  const result = await Swal.fire({
    icon: 'warning',
    title: 'Your order is on track!',
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


export async function confirmPincodeUnavailable() {
  const { default: Swal } = await import('sweetalert2');
  const result = await Swal.fire({
    icon: 'info',
    title: 'Delivery is not available here yet',
    text: 'We are currently not available in this area. We are working on it and would be happy to contact you.',
    showCancelButton: true,
    confirmButtonText: 'Yes, send an enquiry',
    cancelButtonText: 'Continue shopping',
    reverseButtons: true,
    allowOutsideClick: false,
  });
  if (result.isConfirmed) window.location.href = '/contact';
  return result.isConfirmed;
}
