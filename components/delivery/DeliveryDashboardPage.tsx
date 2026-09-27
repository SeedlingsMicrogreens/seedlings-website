'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

type DeliveryItem = { productName: string; packaging: string; boxes: number };
type Delivery = {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  orderType: string;
  customerName: string;
  customerMobile: string;
  address: Record<string, unknown>;
  scheduledDeliveryDate: string;
  items: DeliveryItem[];
  totalBoxes: number;
  assignedAt: string | null;
  deliveredAt: string | null;
};
type DeliveryResponse = { deliveryUser: { id: string; name: string; mobileNumber: string }; deliveries: Delivery[] };

const activeStatuses = new Set(['assigned', 'accepted', 'picked_up', 'out_for_delivery']);

function addressText(address: Record<string, unknown>) {
  return [address.name, address.addressLine1, address.addressLine2, address.landmark, address.city, address.state, address.pincode]
    .map((value) => String(value ?? '').trim()).filter(Boolean).join(', ');
}

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DeliveryDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DeliveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'pending' | 'delivered'>('pending');

  const load = useCallback(async () => {
    const response = await fetch('/api/delivery/deliveries', { cache: 'no-store' });
    const result = await response.json() as DeliveryResponse & { error?: string };
    if (response.status === 401 || response.status === 403) {
      router.replace('/delivery-login');
      return;
    }
    if (!response.ok) throw new Error(result.error || 'Unable to load deliveries.');
    setData(result);
  }, [router]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void load().catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : 'Unable to load deliveries.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [load, router]);

  const pending = useMemo(() => (data?.deliveries ?? []).filter((delivery) => activeStatuses.has(delivery.status)), [data]);
  const delivered = useMemo(() => (data?.deliveries ?? []).filter((delivery) => delivery.status === 'delivered'), [data]);
  const visible = tab === 'pending' ? pending : delivered;

  async function markDelivered(delivery: Delivery) {
    if (!navigator.geolocation) {
      setError('Location access is required to mark a delivery as delivered.');
      return;
    }
    const confirmation = await Swal.fire({
      title: 'Mark delivery as delivered?',
      text: `Your current location will be recorded for ${delivery.orderNumber}.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Mark Delivered',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#2b8a1d',
    });
    if (!confirmation.isConfirmed) return;

    setError('');
    setWorkingId(delivery.id);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
      const response = await fetch('/api/delivery/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: delivery.id, latitude: position.coords.latitude, longitude: position.coords.longitude }),
      });
      const result = await response.json() as { error?: string };
      if (response.status === 401 || response.status === 403) {
        router.replace('/delivery-login');
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Unable to mark delivery as delivered.');
      await load();
      setTab('pending');
    } catch (err) {
      const geolocationError = err as GeolocationPositionError;
      if (typeof geolocationError?.code === 'number' && geolocationError.code > 0) {
        setError(geolocationError.code === 1 ? 'Location permission is required to mark the delivery as delivered.' : 'Unable to get your current location. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to mark delivery as delivered.');
      }
    } finally {
      setWorkingId(null);
    }
  }

  async function logout() {
    await fetch('/api/delivery/logout', { method: 'POST' });
    router.replace('/delivery-login');
  }

  return <>
    <Header />
    <main className="delivery-dashboard-page">
      <section className="page-hero delivery-dashboard-hero">
        <div className="container delivery-dashboard-heading">
          <div><span className="eyebrow">Delivery Partner</span><h1>Deliveries</h1><p>{data ? `Welcome, ${data.deliveryUser.name}` : 'Your assigned deliveries.'}</p></div>
          <button className="btn outline delivery-logout" type="button" onClick={() => void logout()}>Sign out</button>
        </div>
      </section>
      <section className="container delivery-dashboard-content">
        {error && <div className="delivery-page-error" role="alert">{error}</div>}
        <div className="delivery-tabs" role="tablist" aria-label="Delivery status">
          <button className={tab === 'pending' ? 'active' : ''} type="button" onClick={() => setTab('pending')}>Pending <span>{pending.length}</span></button>
          <button className={tab === 'delivered' ? 'active' : ''} type="button" onClick={() => setTab('delivered')}>Delivered <span>{delivered.length}</span></button>
        </div>
        {loading ? <div className="delivery-loading">Loading deliveries…</div> : !visible.length ? <div className="delivery-empty"><strong>{tab === 'pending' ? 'No pending deliveries' : 'No delivered orders yet'}</strong><p>{tab === 'pending' ? 'New deliveries handed over to you will appear here.' : 'Completed deliveries will appear here.'}</p></div> : <div className="delivery-list">
          {visible.map((delivery) => <article className="delivery-card" key={delivery.id}>
            <div className="delivery-card-header"><div><span className="delivery-order-label">Order</span><h2>{delivery.orderNumber}</h2></div><span className={`delivery-card-status ${delivery.status === 'delivered' ? 'delivered' : 'pending'}`}>{delivery.status === 'delivered' ? 'Delivered' : 'To Deliver'}</span></div>
            <div className="delivery-customer"><div><span className="delivery-label">Customer</span><strong>{delivery.customerName || 'Customer'}</strong></div><a href={`tel:${delivery.customerMobile.replace(/\D/g, '')}`}>{delivery.customerMobile || 'Call customer'}</a></div>
            <div className="delivery-section"><span className="delivery-label">Order Info</span><div className="delivery-items">{delivery.items.map((item, index) => <div className="delivery-item" key={`${delivery.id}-${index}`}><div><strong>{item.productName}</strong><span>{item.packaging}</span></div><strong>{item.boxes} {item.boxes === 1 ? 'box' : 'boxes'}</strong></div>)}</div><div className="delivery-total-boxes">Total Boxes <strong>{delivery.totalBoxes}</strong></div></div>
            <div className="delivery-section"><span className="delivery-label">Delivery Address</span><p className="delivery-address">{addressText(delivery.address) || 'Address not available'}</p></div>
            {delivery.scheduledDeliveryDate && <div className="delivery-date">Scheduled: {formatDate(delivery.scheduledDeliveryDate)}</div>}
            {delivery.status !== 'delivered' && <button className="btn primary delivery-complete-button" type="button" onClick={() => void markDelivered(delivery)} disabled={workingId === delivery.id}>{workingId === delivery.id ? 'Getting location…' : 'Mark Delivered'}</button>}
            {delivery.status === 'delivered' && delivery.deliveredAt && <div className="delivery-completed-note">Delivered successfully.</div>}
          </article>)}
        </div>}
      </section>
    </main>
    <Footer />
  </>;
}
