"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { clearStoredCustomerMobile, getStoredCustomerMobile } from '@/lib/clientOnboarding';
import { getCustomerAccount, updateCustomerAddresses, type CustomerAddress } from '@/lib/customerAccount';
import { confirmCustomerAddressDelete } from '@/lib/customerAlerts';

type Address = CustomerAddress & { id: string };

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
}

function uniqueAddressParts(parts: unknown[]) {
  const seen = new Set<string>();
  return parts.map(value => String(value ?? '').trim()).filter(value => {
    if (!value) return false;
    const key = value.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addressLines(address: Address) {
  return uniqueAddressParts([address.name, address.addressLine1, address.addressLine2, address.landmark,
    [address.city, address.state, address.pincode].filter(Boolean).join(', '),
    address.mobileNumber ? `+91 ${address.mobileNumber}` : '']);
}

function renderLogin(root: HTMLElement) {
  root.innerHTML = `<main class="section"><div class="container"><section class="auth-wrap"><div class="auth-card"><span class="eyebrow">My Addresses</span><h1>Sign in to manage your addresses</h1><p>Your saved delivery addresses are available after you sign in.</p><a class="btn primary" href="/account">Go to Account</a></div></section></div></main>`;
}

const ADDRESS_CACHE_PREFIX = 'seedlings-customer-addresses-v1:';

function addressCacheKey(mobile: string) {
  return `${ADDRESS_CACHE_PREFIX}${mobile}`;
}

function readAddressCache(mobile: string): Address[] | null {
  try {
    const raw = window.localStorage.getItem(addressCacheKey(mobile));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Address cache read failed', error);
    return null;
  }
}

function writeAddressCache(mobile: string, addresses: Address[]) {
  try {
    window.localStorage.setItem(addressCacheKey(mobile), JSON.stringify(addresses));
  } catch (error) {
    console.warn('Address cache write failed', error);
  }
}

function renderSkeleton(grid: HTMLElement) {
  grid.innerHTML = Array.from({ length: 2 }, () => `<div class="address-card"><div style="height:12px;width:100px;background:#eee7da;border-radius:8px"></div><div style="height:18px;width:90px;background:#eee7da;border-radius:8px;margin:14px 0"></div><div style="height:12px;width:80%;background:#eee7da;border-radius:8px;margin:8px 0"></div><div style="height:12px;width:65%;background:#eee7da;border-radius:8px;margin:8px 0"></div><div style="height:12px;width:45%;background:#eee7da;border-radius:8px;margin:8px 0"></div></div>`).join('');
}

export default function AddressHydrator({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;

    const wireLogout = () => {
      const side = root.querySelector('.account-side');
      if (!side || root.querySelector('[data-address-logout]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.addressLogout = 'true';
      button.className = 'account-logout';
      button.textContent = '↪ Logout';
      button.setAttribute('aria-label', 'Logout');
      const profile = Array.from(side.querySelectorAll('a')).find(a => (a.getAttribute('href') || '').includes('profile'));
      if (profile) profile.insertAdjacentElement('afterend', button); else side.appendChild(button);
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Logging out…';
        try { await signOut(auth); clearStoredCustomerMobile(); window.location.assign('/account'); }
        catch (error) { console.error('Customer logout failed', error); button.disabled = false; button.textContent = '↪ Logout'; }
      });
    };

    const load = async () => {
      const mobile = getStoredCustomerMobile();
      if (!mobile || !auth.currentUser) { renderLogin(root); return; }
      wireLogout();
      const grid = root.querySelector('.address-grid') as HTMLElement | null;
      if (!grid) return;
      const cached = readAddressCache(mobile);
      if (cached) {
        if (alive) renderAddresses(root, mobile, cached);
        return;
      }

      renderSkeleton(grid);
      try {
        const customer = await getCustomerAccount(mobile);
        if (!customer) throw new Error('Customer account not found.');
        const addresses = (Array.isArray(customer.addresses) ? customer.addresses : [])
          .map((address, index) => ({ ...address, id: String(address.id || `address-${index}`) }));
        writeAddressCache(mobile, addresses);
        if (alive) renderAddresses(root, mobile, addresses);
      } catch (error) {
        console.error('Customer addresses load failed', error);
        if (alive) grid.innerHTML = `<div class="panel" style="grid-column:1/-1"><p class="muted">${esc(error instanceof Error ? error.message : 'Unable to load addresses.')}</p></div>`;
      }
    };

    const unsubscribe = onAuthStateChanged(auth, () => void load());
    return () => { alive = false; unsubscribe(); };
  }, []);

  return <div ref={ref}>{children}</div>;
}

function renderAddresses(root: HTMLElement, mobile: string, addresses: Address[]) {
  const grid = root.querySelector('.address-grid') as HTMLElement | null;
  const accountMain = root.querySelector('.account-main') as HTMLElement | null;
  if (!grid || !accountMain) return;

  accountMain.querySelector('[data-address-form-wrap]')?.remove();
  accountMain.querySelector('[data-address-message]')?.remove();

  const message = document.createElement('div');
  message.dataset.addressMessage = 'true';
  message.style.marginTop = '14px';
  accountMain.appendChild(message);
  const setMessage = (text: string, error = false) => { message.textContent = text; message.style.color = error ? '#a43f35' : ''; };

  const saveAddresses = async (next: Address[], success: string, button?: HTMLButtonElement) => {
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    try {
      const cleaned = next.map(({ id, ...address }) => ({ ...address, id }));
      await updateCustomerAddresses(mobile, cleaned);
      writeAddressCache(mobile, cleaned as Address[]);
      renderAddresses(root, mobile, cleaned as Address[]);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save address.', true);
      if (button) { button.disabled = false; button.textContent = 'Set default'; }
    }
  };

  const openForm = (address?: Address) => {
    accountMain.querySelector('[data-address-form-wrap]')?.remove();
    const formWrap = document.createElement('div');
    formWrap.dataset.addressFormWrap = 'true';
    formWrap.className = 'form';
    formWrap.style.marginTop = '18px';
    formWrap.innerHTML = `<div class="account-title" style="margin-bottom:18px"><div><div class="eyebrow">${address ? 'Edit address' : 'New address'}</div><h3 style="margin:4px 0 0">${address ? 'Edit delivery address' : 'Add delivery address'}</h3></div><button type="button" class="btn mini" data-close>Cancel</button></div><form data-address-form><div class="contact-grid"><div><label>Label<select name="label"><option value="Home" ${address?.label === 'Home' || !address?.label ? 'selected' : ''}>Home</option><option value="Office" ${address?.label === 'Office' ? 'selected' : ''}>Office</option><option value="Tenant" ${address?.label === 'Tenant' ? 'selected' : ''}>Tenant</option><option value="Other" ${address?.label === 'Other' ? 'selected' : ''}>Other</option></select></label><label>Name<input name="name" value="${esc(address?.name)}" placeholder="Full name" required></label><label>Mobile number<input name="mobileNumber" value="${esc(address?.mobileNumber || mobile)}" inputmode="numeric" maxlength="10" required></label><label>Address line 1<input name="addressLine1" value="${esc(address?.addressLine1)}" placeholder="Flat, building, street" required></label></div><div><label>Address line 2<input name="addressLine2" value="${esc(address?.addressLine2)}" placeholder="Area, locality"></label><label>Landmark<input name="landmark" value="${esc(address?.landmark)}" placeholder="Nearby landmark"></label><label>City<input name="city" value="${esc(address?.city)}" placeholder="City" required></label><label>State<input name="state" value="${esc(address?.state)}" placeholder="State" required></label><label>Pincode<input name="pincode" value="${esc(address?.pincode)}" inputmode="numeric" maxlength="6" placeholder="6-digit pincode" required></label></div></div><div class="actions"><button class="btn primary" type="submit">${address ? 'Save changes' : 'Add address'}</button></div></form>`;
    accountMain.appendChild(formWrap);
    formWrap.querySelector('[data-close]')?.addEventListener('click', () => formWrap.remove());
    const form = formWrap.querySelector('form') as HTMLFormElement;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      submit.disabled = true; submit.textContent = 'Saving…'; setMessage('');
      const body = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
      const updated: Address = { id: address?.id || crypto.randomUUID(), label: body.label?.trim() || 'Home', name: body.name?.trim() || '', mobileNumber: body.mobileNumber?.replace(/\D/g, '') || '', addressLine1: body.addressLine1?.trim() || '', addressLine2: body.addressLine2?.trim() || undefined, landmark: body.landmark?.trim() || undefined, city: body.city?.trim() || '', state: body.state?.trim() || '', pincode: body.pincode?.trim() || '' };
      const mobileNumber = updated.mobileNumber ?? '';
      const pincode = updated.pincode ?? '';
      if (!/^\d{10}$/.test(mobileNumber)) { setMessage('Enter a valid 10-digit mobile number.', true); submit.disabled = false; submit.textContent = address ? 'Save changes' : 'Add address'; return; }
      if (!updated.name || !updated.addressLine1 || !updated.city || !updated.state || !/^\d{6}$/.test(pincode)) { setMessage('Please complete all required address fields.', true); submit.disabled = false; submit.textContent = address ? 'Save changes' : 'Add address'; return; }
      const next = address ? addresses.map(item => item.id === address.id ? updated : item) : [...addresses, updated];
      try { await updateCustomerAddresses(mobile, next); writeAddressCache(mobile, next); formWrap.remove(); renderAddresses(root, mobile, next); setMessage(address ? 'Address updated.' : 'Address added.'); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save address.', true); submit.disabled = false; submit.textContent = address ? 'Save changes' : 'Add address'; }
    });
    formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const titleButton = root.querySelector('.account-title button') as HTMLButtonElement | null;
  if (titleButton && !titleButton.dataset.addressWired) { titleButton.dataset.addressWired = 'true'; titleButton.addEventListener('click', () => openForm()); }

  if (!addresses.length) { grid.innerHTML = `<div class="panel" style="grid-column:1/-1;text-align:center"><h3>No saved addresses</h3><p class="muted">Add a delivery address to continue with checkout.</p></div>`; return; }

  grid.innerHTML = addresses.map((address, index) => `<div class="address-card${index === 0 ? ' default' : ''}"><span class="default-label" style="${index === 0 ? '' : 'visibility:hidden'}">Default address</span><h4>${esc(address.label || 'Address')}</h4><p>${addressLines(address).map(esc).join('<br>')}</p><div class="actions"><button class="btn mini" type="button" data-edit="${esc(address.id)}">Edit</button>${index !== 0 ? `<button class="btn mini" type="button" data-default="${esc(address.id)}">Set default</button>` : ''}<button class="btn mini" type="button" data-delete="${esc(address.id)}">Delete</button></div></div>`).join('');

  grid.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => { const address = addresses.find(item => item.id === (button as HTMLElement).dataset.edit); if (address) openForm(address); }));
  grid.querySelectorAll('[data-default]').forEach(button => button.addEventListener('click', async () => {
    const target = button as HTMLButtonElement;
    const id = target.dataset.default;
    if (!id) return;
    const index = addresses.findIndex(item => item.id === id);
    if (index < 0) return;
    const next = [addresses[index], ...addresses.filter((_, i) => i !== index)];
    await saveAddresses(next, 'Default address updated.', target);
  }));

  grid.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
    const target = button as HTMLButtonElement;
    const id = target.dataset.delete;
    if (!id) return;
    const index = addresses.findIndex(item => item.id === id);
    if (index < 0) return;
    const address = addresses[index];
    const confirmed = await confirmCustomerAddressDelete(address.label || 'this address');
    if (!confirmed) return;

    target.disabled = true;
    target.textContent = 'Deleting…';
    const next = addresses.filter(item => item.id !== id);
    try {
      await updateCustomerAddresses(mobile, next);
      writeAddressCache(mobile, next);
      renderAddresses(root, mobile, next);
      setMessage('Address deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete address.', true);
      target.disabled = false;
      target.textContent = 'Delete';
    }
  }));
}
