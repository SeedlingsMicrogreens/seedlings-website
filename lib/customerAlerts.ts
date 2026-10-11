export type HarvestShortageMode = 'one-time' | 'subscription';

export async function confirmHarvestShortage(args: {
  mode: HarvestShortageMode;
  availableGrams: number;
  requestedGrams: number;
  shortageGrams: number;
  deliveryDate?: string;
  alternativeDeliveryDate?: string;
}) {
  const { default: Swal } = await import('sweetalert2');
  const requested = Math.max(0, Math.floor(args.requestedGrams));
  const shortage = Math.max(0, Math.floor(args.shortageGrams));
  const requestedDate = String(args.deliveryDate || '').trim();
  const alternativeDate = String(args.alternativeDeliveryDate || '').trim();
  const formatDate = (value: string) => value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'a later delivery date';
  const requestedDateHtml = requestedDate ? `<strong>${formatDate(requestedDate)}</strong>` : '<strong>the requested delivery date</strong>';
  const alternativeDateHtml = alternativeDate ? `<strong>${formatDate(alternativeDate)}</strong>` : '<strong>a later delivery date</strong>';
  const isSubscription = args.mode === 'subscription';
  const message = isSubscription
    ? `The full subscription quantity of <strong>${requested.toLocaleString()} gms</strong> is not available on ${requestedDateHtml}. We can deliver the complete quantity on ${alternativeDateHtml}.`
    : `The full order quantity of <strong>${requested.toLocaleString()} gms</strong> is not available on ${requestedDateHtml}. We can deliver the complete quantity on ${alternativeDateHtml}.`;
  const result = await Swal.fire({
    icon: 'info',
    title: 'Delivery date needs to be changed',
    html: `${message}<br><br><span class="muted">${shortage.toLocaleString()} gms is currently unavailable on the requested date. We will not deliver a partial quantity.</span><br><br>Would you like to continue with the updated delivery date?`,
    showCancelButton: true,
    confirmButtonText: 'Yes, update date',
    cancelButtonText: 'No, update cart',
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


export async function confirmPincodeUnavailable(args?: {
  customerId?: string;
  name?: string;
  mobile?: string;
  email?: string;
  pincode?: string;
  productName?: string;
  address?: Record<string, unknown>;
  cartContext?: Record<string, unknown>;
}) {
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
  if (result.isConfirmed) {
    const { createCustomerContactRequest } = await import('@/lib/customerContactRequests');
    const pincode = String(args?.pincode || '').trim();
    await createCustomerContactRequest({
      customerId: args?.customerId,
      name: String(args?.name || 'Customer'),
      mobile: String(args?.mobile || ''),
      email: String(args?.email || ''),
      productName: String(args?.productName || `Delivery serviceability - ${pincode}`),
      message: `Customer requested delivery to pincode ${pincode}, but the pincode is not currently serviceable. Customer requested to be contacted.`,
      source: 'customer_checkout',
      status: 'open',
      enquiryReason: 'NON_SERVICEABLE_PINCODE',
      contactRequired: true,
      pincode,
      address: args?.address,
      cartContext: args?.cartContext,
    });
    await Swal.fire({
      icon: 'success',
      title: 'Enquiry submitted',
      text: `We couldn't deliver to pincode ${pincode} yet. Your enquiry has been submitted and our team will contact you.`,
      confirmButtonText: 'OK',
    });
  }
  return result.isConfirmed;
}

export async function confirmHighDemandEnquiry(args: {
  customerId?: string;
  name?: string;
  mobile?: string;
  email?: string;
  address?: Record<string, unknown>;
  items: Array<{
    productId: string;
    productName: string;
    requestedGrams: number;
    requestedDeliveryDate: string;
    thresholdGrams: number;
    /** Defaults to HIGH_DEMAND; AVAILABILITY_SHORTAGE when an applicable batch cannot supply the quantity. */
    enquiryReason?: 'HIGH_DEMAND' | 'AVAILABILITY_SHORTAGE';
    /** The subsequent delivery date that was also checked, if any. */
    nextDeliveryDate?: string;
  }>;
  /** Called after each enquiry is saved, so the caller can remove that item before a later failure. */
  onItemSaved?: (productId: string, index: number) => void;
}) {
  const { default: Swal } = await import('sweetalert2');
  const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
  const rows = args.items.map(item => `<li style="margin:6px 0;text-align:left"><strong>${safe(item.productName)}</strong> — ${Math.floor(item.requestedGrams).toLocaleString()}g for ${safe(item.requestedDeliveryDate)}</li>`).join('');
  const result = await Swal.fire({
    icon: 'info',
    title: 'We are currently facing high demand',
    html: `<p style="margin:0 0 10px">We cannot fulfil the requested quantity right now.</p><ul style="padding-left:20px;margin:0 0 12px">${rows}</ul><p style="margin:0">Would you like us to contact you regarding this request?</p>`,
    showCancelButton: true,
    confirmButtonText: 'Send Enquiry',
    cancelButtonText: 'Continue shopping',
    reverseButtons: true,
    allowOutsideClick: false,
  });
  if (!result.isConfirmed) return false;

  const { createCustomerContactRequest, buildHighDemandEnquiryMessage, buildShortageEnquiryMessage } = await import('@/lib/customerContactRequests');
  for (const [index, item] of args.items.entries()) {
    const reason = item.enquiryReason || 'HIGH_DEMAND';
    await createCustomerContactRequest({
      customerId: args.customerId,
      name: String(args.name || 'Customer'),
      mobile: String(args.mobile || ''),
      email: String(args.email || ''),
      productId: item.productId,
      productName: item.productName,
      message: reason === 'HIGH_DEMAND'
        ? buildHighDemandEnquiryMessage(item)
        : buildShortageEnquiryMessage({ ...item, checkedNextDate: item.nextDeliveryDate }),
      source: 'customer_checkout',
      status: 'open',
      requestedQuantityGrams: item.requestedGrams,
      requestedDeliveryDate: item.requestedDeliveryDate,
      enquiryReason: reason,
      contactRequired: true,
      address: args.address,
    });
    args.onItemSaved?.(item.productId, index);
  }
  await Swal.fire({ icon: 'success', title: 'Enquiry submitted', text: 'Your enquiry has been submitted. Our team will contact you.', confirmButtonText: 'OK' });
  return true;
}

/**
 * Cart items that can be delivered only on the next delivery date. Lists every
 * cart item with the delivery date it would receive. Yes keeps those dates.
 */
export async function confirmHighDemandDeliveryDates(items: Array<{ productName: string; kind: 'one-time' | 'subscription'; requestedDate: string; deliveryDate: string }>) {
  const { default: Swal } = await import('sweetalert2');
  const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
  const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const cell = 'padding:8px 10px;border-bottom:1px solid #eee;text-align:left';
  const rows = items.map(item => {
    const moved = item.deliveryDate !== item.requestedDate;
    return `<tr><td style="${cell}">${safe(item.productName)}<br><small class="muted">${item.kind === 'subscription' ? 'Subscription' : 'One-time'}</small></td><td style="${cell}">${moved ? `<strong>${formatDate(item.deliveryDate)}</strong><br><small class="muted">Requested ${formatDate(item.requestedDate)}</small>` : formatDate(item.deliveryDate)}</td></tr>`;
  }).join('');
  const result = await Swal.fire({
    icon: 'info',
    title: 'Delivery availability update',
    html: `<p style="margin:0 0 12px">We are facing high demand. Would you like to proceed with the available delivery dates?</p><table style="width:100%;border-collapse:collapse;margin:0"><thead><tr><th style="padding:8px 10px;background:#f5f7ef;text-align:left">Product</th><th style="padding:8px 10px;background:#f5f7ef;text-align:left">Delivery date</th></tr></thead><tbody>${rows}</tbody></table>`,
    showCancelButton: true,
    confirmButtonText: 'Yes, Place order',
    cancelButtonText: 'No, Send Enquiry',
    reverseButtons: true,
    focusCancel: true,
    allowOutsideClick: false,
    allowEscapeKey: false,
  });
  return result.isConfirmed;
}
