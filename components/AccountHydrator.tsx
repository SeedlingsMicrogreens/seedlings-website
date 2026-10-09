"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, getCountFromServer, getDocsFromServer, query, where } from "firebase/firestore";
import { getCustomerAccount } from "@/lib/customerAccount";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

function formatLongDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function packLabel(weightGrams: number, quantity: number, packaging?: number) {
  if (!Number.isFinite(weightGrams) || !Number.isFinite(quantity) || quantity < 1) return "";
  const pack = Number(packaging) > 0 ? Number(packaging) : weightGrams;
  const weight = pack >= 1000 && pack % 1000 === 0 ? `${pack / 1000}kg` : `${pack}g`;
  return `${weight} × ${quantity}`;
}

function renderLogin(root: HTMLElement) {
  window.dispatchEvent(new CustomEvent("seedlings-open-login", { detail: { redirectTo: "/microgreens" } }));
}


export default function AccountHydrator({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;

    const hydrate = async () => {
      const mobile = getStoredCustomerMobile();
      const user = auth.currentUser;
      if (!mobile || !user) {
        renderLogin(root);
        return;
      }
      try {
        const [account, activeSubscriptionsSnapshot, orderCountSnapshot] = await Promise.all([
          getCustomerAccount(mobile, { bypassCache: true }),
          getDocsFromServer(query(
            collection(db, "subscriptions"),
            where("customerId", "==", mobile),
            where("status", "==", "active"),
          )),
          getCountFromServer(query(collection(db, "orders"), where("customerId", "==", mobile))),
        ]);
        if (!account) throw new Error("Customer account not found.");
        if (!alive) return;

        const activeSubscriptions: Array<Record<string, any> & { id: string }> = activeSubscriptionsSnapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Record<string, any>) }));
        const pastOrderCount = Number(orderCountSnapshot.data().count || 0);
        const dateValue = (value: unknown) => {
          if (typeof value === "string") return value.slice(0, 10);
          if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
          return "";
        };
        const upcoming = activeSubscriptions.filter((item: any) => dateValue(item.nextDeliveryDate)).sort((a: any, b: any) => dateValue(a.nextDeliveryDate).localeCompare(dateValue(b.nextDeliveryDate)))[0] || null;
        const data = {
          customer: { name: account.name || "", mobile },
          activeSubscriptionCount: activeSubscriptions.length,
          pastOrderCount,
          currentSubscription: upcoming,
          upcomingDelivery: upcoming ? { date: dateValue(upcoming.nextDeliveryDate), productName: upcoming.productName, packaging: Number(upcoming.packaging || 0), weightGrams: Number(upcoming.weightGrams || 0), quantity: Number(upcoming.quantity || 0), deliveryAddress: upcoming.deliveryAddress || null } : null,
        };

        const customerName = data.customer?.name || "Customer";
        const heading = root.querySelector(".account-title h1") as HTMLElement | null;
        if (heading) heading.textContent = `Welcome back, ${customerName}`;

        const kpis = root.querySelectorAll(".kpi");
        if (kpis[0]) {
          const value = kpis[0].querySelector("strong");
          if (value) value.textContent = String(data.activeSubscriptionCount ?? 0);
        }
        if (kpis[1]) {
          const value = kpis[1].querySelector("strong");
          if (value) value.textContent = formatDate(data.upcomingDelivery?.date || "");
        }
        if (kpis[2]) {
          const value = kpis[2].querySelector("strong");
          if (value) value.textContent = String(data.pastOrderCount ?? 0);
        }

        const panels = root.querySelectorAll(".account-main .panel");
        const current = data.currentSubscription;
        if (panels[0]) {
          const row = panels[0].querySelector(".order-row");
          const strong = row?.querySelector("strong");
          const meta = row?.querySelector(".order-meta");
          const status = row?.querySelector(".status");
          if (current) {
            if (strong) strong.textContent = `${current.productName || "Subscription"} · ${packLabel(Number(current.weightGrams), Number(current.quantity), Number(current.packaging))}`;
            if (meta) meta.textContent = `${String(current.frequency || "").replace(/_/g, " ")} · ${Number(current.totalDeliveries || 0)} deliveries · Saturday delivery`;
            if (status) status.textContent = String(current.status || "ACTIVE").toUpperCase();
          } else {
            if (strong) strong.textContent = "No active subscription";
            if (meta) meta.textContent = "Start a subscription from the Microgreens catalogue.";
            if (status) status.textContent = "NONE";
          }
        }

        if (panels[1]) {
          const row = panels[1].querySelector(".order-row");
          const strong = row?.querySelector("strong");
          const meta = row?.querySelector(".order-meta");
          const status = row?.querySelector(".status");
          const delivery = data.upcomingDelivery;
          if (delivery) {
            if (strong) strong.textContent = formatLongDate(delivery.date);
            if (meta) meta.textContent = `${packLabel(Number(delivery.weightGrams), Number(delivery.quantity), Number(delivery.packaging)) || "Upcoming delivery"} · Home address`;
            if (status) status.textContent = "UPCOMING";
          } else {
            if (strong) strong.textContent = "No upcoming delivery";
            if (meta) meta.textContent = "There are no scheduled deliveries.";
            if (status) status.textContent = "NONE";
          }
        }
      } catch (error) {
        console.error("Customer account dashboard hydration failed", error);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, () => void hydrate());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
