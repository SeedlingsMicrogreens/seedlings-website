"use client";
import type React from 'react';
import { useEffect } from 'react';
import { getActiveSalesProducts, type SalesProduct } from '@/lib/salesProducts';
import { loadActiveCustomerSubscriptionPlans } from '@/lib/customerSubscriptions';
import { getUnifiedCart, removeFromCart, removeSubscriptionFromCart, setCartQuantity, setSubscriptionCartQuantity, type SubscriptionCartItem } from '@/lib/cart';
import { packagingLabel } from '@/lib/packaging';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(v:number,currency='INR')=>{try{return new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:0}).format(v)}catch{return `₹${v}`}};
const dateLabel=(v:string)=>{try{return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${v}T00:00:00`))}catch{return v}};

export default function CartHydrator({children}:{children:React.ReactNode}){
 useEffect(()=>{
  const root=document.querySelector('[data-cart-root]') as HTMLElement|null;if(!root)return;
  let dead=false;
  const render=async()=>{
   const cart=getUnifiedCart();
   const [products,plans]=await Promise.all([getActiveSalesProducts(),loadActiveCustomerSubscriptionPlans().catch(()=>[])]);
   if(dead)return;
   const byId=new Map(products.map(p=>[p.id,p]));
   const one=cart.oneTimeItems, subs=cart.subscriptionItems;
   if(!one.length&&!subs.length){root.innerHTML=`<section class="auth-wrap"><div class="auth-card"><span class="eyebrow">Cart</span><h1>Your cart is empty</h1><p>Add fresh microgreens or choose a subscription from the catalogue.</p><a class="btn primary" style="width:100%;text-align:center" href="/microgreens">Browse Microgreens</a></div></section>`;return;}
   const productData=(id:string)=>byId.get(id);
   const oneTotal=one.reduce((s,i)=>s+Number(productData(i.productId)?.sellingPrice??i.price)*i.quantity,0);
   const subTotal=subs.reduce((s,i)=>s+Number(i.price)*i.quantity,0);
   const oneMrp=one.reduce((s,i)=>s+Math.max(Number(productData(i.productId)?.mrp??i.mrp??i.price),Number(productData(i.productId)?.sellingPrice??i.price))*i.quantity,0);
   const oneSavings=Math.max(0,oneMrp-oneTotal);
   const currency=one[0]?.currency||subs[0]?.currency||'INR';
   const rowOne=(i:any)=>{const price=Number(i.price??0);return `<div class="cart-item" data-one-id="${esc(i.productId)}"><div class="cart-thumb"${i.imageUrl?` style="background-image:url('${esc(i.imageUrl)}');background-size:cover;background-position:center"`:''}></div><div style="min-width:0"><strong>${esc(i.name)}</strong><p class="muted">One-time purchase · ${esc(packagingLabel(i.packaging))} pack</p><div class="qty"><button data-minus>−</button><strong>${i.quantity}</strong><button data-plus>+</button></div><button type="button" data-remove class="cart-remove">Remove</button></div><span class="price">${esc(money(price*i.quantity,i.currency))}</span></div>`};
   const rowSub=(i:SubscriptionCartItem)=>`<div class="cart-item" data-sub-id="${esc(i.productId)}" data-plan-id="${esc(i.planId)}" data-start-date="${esc(i.startDate)}"><div class="cart-thumb"${i.imageUrl?` style="background-image:url('${esc(i.imageUrl)}');background-size:cover;background-position:center"`:''}></div><div style="min-width:0"><strong>${esc(i.name)}</strong><p class="muted">${esc(i.planName)} · ${esc(i.frequency||'Recurring')} · ${esc(packagingLabel(i.packaging))} pack</p><p class="muted" style="margin:2px 0 10px">Start date: <strong>${esc(dateLabel(i.startDate))}</strong></p><div class="qty"><button data-minus>−</button><strong>${i.quantity}</strong><button data-plus>+</button></div><button type="button" data-remove class="cart-remove">Remove</button><button type="button" data-edit class="cart-edit">Edit subscription</button></div><span class="price">${esc(money(Number(i.price)*i.quantity,i.currency))}</span></div>`;
   const planWarning=subs.some(i=>!plans.some(p=>p.id===i.planId && String(p.salableProductId ?? '')===String(i.productId)));
   root.innerHTML=`<section class="section"><div class="container checkout-grid"><div class="cart-list"><span class="eyebrow">Your cart</span><h1 style="margin:8px 0 24px">Fresh deliveries, together</h1>${subs.length?`<div class="cart-section"><h3>Subscriptions</h3>${subs.map(rowSub).join('')}</div>`:''}${one.length?`<div class="cart-section" style="margin-top:28px"><h3>One-time purchases</h3>${one.map(rowOne).join('')}</div>`:''}${planWarning?`<p class="checkout-message" style="color:crimson">One of your selected subscription plans is no longer active. Edit or remove it before checkout.</p>`:''}</div><aside class="summary"><h3>Cart summary</h3>${subs.length?`<div class="summary-row"><span>Subscriptions</span><strong>${esc(money(subTotal,currency))}</strong></div>`:''}${one.length?`<div class="summary-row"><span>One-time purchases</span><strong>${esc(money(oneTotal,currency))}</strong></div>`:''}${oneSavings?`<div class="summary-row summary-saving"><span>You save</span><strong>${esc(money(oneSavings,currency))}</strong></div>`:''}<div class="summary-row"><span>Delivery</span><span>Calculated at checkout</span></div><div class="summary-row summary-total"><span>Total</span><span>${esc(money(oneTotal+subTotal,currency))}</span></div><a class="btn primary" style="width:100%;margin-top:18px;${planWarning?'pointer-events:none;opacity:.5':''}" href="/checkout">Proceed to Checkout</a></aside></div></section>`;
   root.querySelectorAll<HTMLElement>('[data-one-id]').forEach(row=>{const id=row.dataset.oneId!;row.querySelector('[data-minus]')?.addEventListener('click',()=>{const i=getUnifiedCart().oneTimeItems.find(x=>x.productId===id);if(i)setCartQuantity(id,i.quantity-1);void render()});row.querySelector('[data-plus]')?.addEventListener('click',()=>{const i=getUnifiedCart().oneTimeItems.find(x=>x.productId===id);if(i)setCartQuantity(id,i.quantity+1);void render()});row.querySelector('[data-remove]')?.addEventListener('click',()=>{removeFromCart(id);void render()})});
   root.querySelectorAll<HTMLElement>('[data-sub-id]').forEach(row=>{const id=row.dataset.subId!,plan=row.dataset.planId!,start=row.dataset.startDate!;row.querySelector('[data-minus]')?.addEventListener('click',()=>{const i=getUnifiedCart().subscriptionItems.find(x=>x.productId===id&&x.planId===plan&&x.startDate===start);if(i)setSubscriptionCartQuantity(id,plan,start,i.quantity-1);void render()});row.querySelector('[data-plus]')?.addEventListener('click',()=>{const i=getUnifiedCart().subscriptionItems.find(x=>x.productId===id&&x.planId===plan&&x.startDate===start);if(i)setSubscriptionCartQuantity(id,plan,start,i.quantity+1);void render()});row.querySelector('[data-remove]')?.addEventListener('click',()=>{removeSubscriptionFromCart(id,plan,start);void render()});row.querySelector('[data-edit]')?.addEventListener('click',()=>{window.location.href=`/product/${encodeURIComponent(iSlug(id,products))}?editPlan=${encodeURIComponent(plan)}&editStartDate=${encodeURIComponent(start)}&editQuantity=${encodeURIComponent(String((getUnifiedCart().subscriptionItems.find(x=>x.productId===id&&x.planId===plan&&x.startDate===start)?.quantity)||1))}&editPackaging=${encodeURIComponent(String((getUnifiedCart().subscriptionItems.find(x=>x.productId===id&&x.planId===plan&&x.startDate===start)?.packaging)||100))}`})});
  };
  const iSlug=(id:string,ps:SalesProduct[])=>ps.find(p=>p.id===id)?.slug||ps.find(p=>p.id===id)?.name||id;
  void render();const onCart=()=>void render();window.addEventListener('seedlings-cart-updated',onCart);return()=>{dead=true;window.removeEventListener('seedlings-cart-updated',onCart)};
 },[]);
 return <>{children}</>;
}
