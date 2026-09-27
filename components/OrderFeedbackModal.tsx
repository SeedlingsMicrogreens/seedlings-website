"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const ORDER_FEEDBACK_OPTIONS = [
  ["freshness", "Freshness"],
  ["packaging", "Packaging"],
  ["cleanliness", "Cleanliness"],
  ["product_quality", "Product Quality"],
  ["value_for_money", "Value for Money"],
  ["quantity", "Quantity"],
  ["other", "Other"],
] as const;

export const DELIVERY_FEEDBACK_OPTIONS = [
  ["on_time", "Delivered on time"],
  ["less_calling", "Less / appropriate calling"],
  ["easy_communication", "Easy communication"],
  ["polite_partner", "Polite delivery partner"],
  ["proper_handling", "Proper handling of products"],
  ["right_location", "Delivery at the right location"],
  ["other", "Other"],
] as const;

type Props = {
  open: boolean;
  orderId: string;
  orderNumber: string;
  customerId: string;
  subscriptionDeliveryId?: string;
  onClose: () => void;
  onSubmitted: () => void;
};

export default function OrderFeedbackModal({ open, orderId, orderNumber, customerId, subscriptionDeliveryId, onClose, onSubmitted }: Props) {
  const [orderRating, setOrderRating] = useState(0);
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [orderOptions, setOrderOptions] = useState<string[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setOrderRating(0); setDeliveryRating(0); setOrderOptions([]); setDeliveryOptions([]); setComment(""); setError("");
    setTimeout(() => first.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const toggle = (value: string, set: React.Dispatch<React.SetStateAction<string[]>>) => set((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  const submit = async () => {
    if (orderRating < 1 || deliveryRating < 1) { setError("Please give both the order and delivery a rating."); return; }
    setSaving(true); setError("");
    try {
      const feedbackId = subscriptionDeliveryId ? `${orderId}_${subscriptionDeliveryId}` : orderId;
      await setDoc(doc(collection(db, "orderFeedback"), feedbackId), {
        orderId,
        customerId,
        subscriptionDeliveryId: subscriptionDeliveryId || null,
        orderRating,
        orderFeedbackOptions: orderOptions,
        deliveryRating,
        deliveryFeedbackOptions: deliveryOptions,
        comment: comment.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit feedback. Please try again.");
    } finally { setSaving(false); }
  };

  return <div className="feedback-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="order-feedback-title">
      <div className="feedback-modal-head"><div><div className="eyebrow">Order #{orderNumber}</div><h2 id="order-feedback-title">Share your feedback</h2></div><button type="button" className="feedback-modal-close" onClick={onClose} disabled={saving} aria-label="Close">×</button></div>
      <div className="feedback-modal-body">
        <section className="feedback-group"><h3>How was your order?</h3><Rating value={orderRating} onChange={setOrderRating} label="Order rating" firstRef={first}/><div className="feedback-options">{ORDER_FEEDBACK_OPTIONS.map(([value,label]) => <label key={value} className={`feedback-option ${orderOptions.includes(value) ? "selected" : ""}`}><input type="checkbox" checked={orderOptions.includes(value)} onChange={() => toggle(value,setOrderOptions)}/><span>{label}</span></label>)}</div></section>
        <section className="feedback-group"><h3>How was the delivery?</h3><Rating value={deliveryRating} onChange={setDeliveryRating} label="Delivery rating"/><div className="feedback-options">{DELIVERY_FEEDBACK_OPTIONS.map(([value,label]) => <label key={value} className={`feedback-option ${deliveryOptions.includes(value) ? "selected" : ""}`}><input type="checkbox" checked={deliveryOptions.includes(value)} onChange={() => toggle(value,setDeliveryOptions)}/><span>{label}</span></label>)}</div></section>
        <section className="feedback-group"><label className="feedback-comment-label" htmlFor="order-feedback-comment"><h3>Comment about your order <span>(optional)</span></h3></label><textarea id="order-feedback-comment" value={comment} onChange={(e) => setComment(e.target.value.slice(0,1000))} placeholder="Tell us anything else about your order…" rows={4}/></section>
        {error && <p className="feedback-error" role="alert">{error}</p>}
      </div>
      <div className="feedback-modal-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button><button type="button" className="btn primary" onClick={submit} disabled={saving}>{saving ? "Submitting…" : "Submit Feedback"}</button></div>
    </div>
  </div>;
}

function Rating({ value, onChange, label, firstRef }: { value: number; onChange: (value: number) => void; label: string; firstRef?: React.RefObject<HTMLButtonElement | null> }) {
  return <div className="feedback-rating" role="radiogroup" aria-label={label}>{[1,2,3,4,5].map((n) => <button key={n} ref={n===1 ? firstRef : undefined} type="button" role="radio" aria-checked={value===n} aria-label={`${n} out of 5`} className={n<=value ? "active" : ""} onClick={() => onChange(n)}>★</button>)}</div>;
}
