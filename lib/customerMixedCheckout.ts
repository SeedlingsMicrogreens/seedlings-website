import { collection, doc, documentId, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth } from './firebase';
import { db } from './firebase';
import { checkProductAvailability, nextWeekSaturday, resolveCartDeliveryDates } from './customerOrderAvailability';
import { checkoutSubscriptionDate, type CartItem, type SubscriptionCartItem } from './cart';
import type { CustomerAddress } from './customerAccount';
import type { SalesProduct } from './salesProducts';
import { calculateCheckoutDeliveryCharges, getWeeklyDeliveryDates } from './deliveryCharges';

import { calculateCustomerOffers, calculateCustomerSubscriptionEntitlements } from './offers';
import { allocateCheckoutTotals, checkoutDeliveryChargeAmounts, resolveOneTimePrice, resolveSubscriptionPrice, subscriptionDeliveriesPerTerm, subscriptionEndDate } from './checkoutPricing';
import { summaryFromOrders } from './checkoutFingerprint';
import { resumedMixedCheckoutResult } from './checkoutClaimFlow';
import { beginCheckoutClaim, registerCheckoutClaim } from './checkoutClaimClient';

const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const mobileOf=(v:unknown)=>String(v??'').replace(/\D/g,'').slice(-10);
const orderNumber=()=>`ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

export async function createCustomerMixedCheckout(input:{mobile:string;addressId:string;deliverySlot:string;paymentMethod?:string;oneTimeItems:CartItem[];subscriptionItems:SubscriptionCartItem[]}){
 const authUid = auth.currentUser?.uid;
 if (!authUid) throw new Error('Your login session expired. Please sign in again.');
 const mobile=mobileOf(input.mobile);if(mobile.length!==10)throw new Error('Invalid customer mobile number.');const deliverySlot=clean(input.deliverySlot)||nextWeekSaturday();const paymentMethod='online';
 if(!clean(input.addressId))throw new Error('Delivery address is required.');
 if(!input.oneTimeItems.length&&!input.subscriptionItems.length)throw new Error('Cart is empty.');
 const customerRef=doc(db,'customers',mobile);const customerSnap=await getDoc(customerRef);if(!customerSnap.exists())throw new Error('Customer account not found.');
 const customer=customerSnap.data()||{};if(customer.status==='blocked')throw new Error('This customer account is blocked.');
 const addresses=Array.isArray(customer.addresses)?customer.addresses:[];const address=addresses.find((a:Record<string,unknown>)=>String(a?.id??'')===input.addressId) as CustomerAddress|undefined;if(!address)throw new Error('Selected delivery address was not found.');
 const oneIds=input.oneTimeItems.map(i=>clean(i.productId));const subIds=input.subscriptionItems.map(i=>clean(i.productId));const allIds=[...new Set([...oneIds,...subIds])];
 const snaps=await Promise.all(allIds.map(id=>getDoc(doc(db,'salesProducts',id))));const byId=new Map(allIds.map((id,n)=>[id,snaps[n]]));
 const planIds=[...new Set(input.subscriptionItems.map(i=>clean(i.planId)).filter(Boolean))];const planChunks:string[][]=[];for(let i=0;i<planIds.length;i+=30)planChunks.push(planIds.slice(i,i+30));const planSnapshots=await Promise.all(planChunks.map(chunk=>getDocs(query(collection(db,'subscriptionPlans'),where(documentId(),'in',chunk)))));const planById=new Map(planSnapshots.flatMap(s=>s.docs).map(d=>[d.id,d.data()]));
 // Subscriptions never use a past/too-early date: an accepted Cart date that is
 // now before next week's Saturday sends the customer back to Cart to re-check.
 const earliestDeliveryDate=nextWeekSaturday();
 const subscriptionDate=(item:SubscriptionCartItem)=>checkoutSubscriptionDate(item,earliestDeliveryDate);
 if(input.subscriptionItems.some(item=>!subscriptionDate(item)))throw new Error('DELIVERY_DATE_RECHECK_REQUIRED');
 const resolvedCart=await resolveCartDeliveryDates([
  ...input.subscriptionItems.map(item=>({key:`subscription:${item.productId}:${item.planId}:${item.startDate}`,kind:'subscription' as const,product:{id:item.productId,...(byId.get(item.productId)?.data()||{})} as SalesProduct,quantity:item.quantity,packagingGrams:item.packaging,requestedDate:subscriptionDate(item),name:item.name})),
  ...input.oneTimeItems.map(item=>({key:`one-time:${item.productId}`,kind:'one-time' as const,product:{id:item.productId,...(byId.get(item.productId)?.data()||{})} as SalesProduct,quantity:item.quantity,packagingGrams:item.packaging,requestedDate:item.deliveryDate||nextWeekSaturday(),name:item.name})),
 ],{maxWeeks:12});
 const resolvedByKey=new Map(resolvedCart.items.map(item=>[item.key,item]));
 const resolvedHighDemand=resolvedCart.items.filter(item=>item.highDemand);
 if(resolvedHighDemand.length) throw new Error(`HIGH_DEMAND_ENQUIRY_REQUIRED:${JSON.stringify(resolvedHighDemand.map(item=>({key:item.key,thresholdGrams:item.thresholdGrams||0,committedDemandGrams:0})))}`);
 for(const item of input.subscriptionItems){const resolved=resolvedByKey.get(`subscription:${item.productId}:${item.planId}:${item.startDate}`);if(!resolved?.deliveryDate||resolved.deliveryDate!==(subscriptionDate(item)))throw new Error('DELIVERY_DATE_RECHECK_REQUIRED');}
 for(const item of input.oneTimeItems){const resolved=resolvedByKey.get(`one-time:${item.productId}`);if(!resolved?.deliveryDate||resolved.deliveryDate!==(item.deliveryDate||nextWeekSaturday()))throw new Error('DELIVERY_DATE_RECHECK_REQUIRED');}
 const oneTimeDeliveryDates=[...new Set(input.oneTimeItems.map(item=>resolvedByKey.get(`one-time:${item.productId}`)?.deliveryDate||item.deliveryDate||nextWeekSaturday()).filter(Boolean))];
 const subscriptionDeliveryInputs=input.subscriptionItems.map(item=>{
  const plan=planById.get(item.planId)||{};
  const deliveries=subscriptionDeliveriesPerTerm(plan);
  const first=resolvedByKey.get(`subscription:${item.productId}:${item.planId}:${item.startDate}`)?.deliveryDate||subscriptionDate(item);
  return {planId:item.planId,planName:item.planName,deliveryDates:getWeeklyDeliveryDates(first,deliveries)};
 });
 const deliveryCharges=await calculateCheckoutDeliveryCharges({pincode:String((address as any).pincode||''),oneTime:input.oneTimeItems.length>0,oneTimeDates:oneTimeDeliveryDates,subscriptions:subscriptionDeliveryInputs});
 const geoId=deliveryCharges.oneTime.sourceId||deliveryCharges.subscriptions[0]?.sourceId||''; const geoName=deliveryCharges.oneTime.sourceName||deliveryCharges.subscriptions[0]?.sourceName||'';
 const subscriptionEntitlements=await calculateCustomerSubscriptionEntitlements(input.subscriptionItems.map(item=>{
  const plan=planById.get(item.planId)||{};
  const regularDeliveries=subscriptionDeliveriesPerTerm(plan);
  return {
   frequency:clean(plan.frequency).toLowerCase(),
   regularDeliveries,
   pincode:String((address as any).pincode||''),
   geoId,
   locationName:geoName,
  };
 }));
 const targetDate=nextWeekSaturday();
 let oneSubtotal=0,oneMrpSubtotal=0;const oneOrders:Record<string,unknown>[]=[];const subscriptionWrites:{ref:ReturnType<typeof doc>;data:Record<string,unknown>;orderRef:ReturnType<typeof doc>;order:Record<string,unknown>}[]=[];
 const availabilityResults:{availableGrams:number;requestedGrams:number;shortageGrams:number;hasShortage:boolean;highDemand:boolean;thresholdGrams:number;committedDemandGrams:number}[]=[];
 for(const item of input.oneTimeItems){const snap=byId.get(item.productId);if(!snap?.exists())throw new Error(`Product "${item.name}" is no longer available.`);const p=snap.data()||{};if(p.active!==true||p.oneTimePurchase!==true)throw new Error(`Product "${p.name||item.name}" is not available for one-time purchase.`);const q=Number(item.quantity);if(!Number.isInteger(q)||q<1)throw new Error('Item quantities must be at least 1.');const {price,mrp,packaging,selectedOption}=resolveOneTimePrice(p,item.packaging,item.name);const weight=packaging*q;const itemDeliveryDate=item.deliveryDate||targetDate;const avail=await checkProductAvailability({product:{id:snap.id,...p} as any,quantity:q,packagingGrams:packaging,deliveryDate:itemDeliveryDate});availabilityResults.push(avail);oneSubtotal+=price*q;oneMrpSubtotal+=mrp*q;oneOrders.push({salableProductId:snap.id,salableProductSku:clean(p.sku),salableProductType:p.type==='multiple'?'multiple':'single',productId:snap.id,productName:clean(p.name),productSlug:clean(p.slug),sellingOptionId:selectedOption?.id||'',sellingOptionLabel:selectedOption?`${packaging>=1000&&packaging%1000===0?packaging/1000+'kg':packaging+'g'} box`:`${packaging>=1000&&packaging%1000===0?packaging/1000+'kg':packaging+'g'} box`,packaging,weightGrams:weight,quantity:q,mrp,unitPrice:price,lineTotal:price*q,deliveryDate:itemDeliveryDate,imageUrl:clean(p.imageUrl)});}
 for (const [subscriptionIndex, item] of input.subscriptionItems.entries()) {
  const snap = byId.get(item.productId);
  if (!snap?.exists()) throw new Error(`Product "${item.name}" is no longer available.`);
  const p = snap.data() || {};
  if (p.active !== true) throw new Error(`Product "${p.name || item.name}" is no longer available.`);
  const q = Number(item.quantity);
  if (!Number.isInteger(q) || q < 1) throw new Error('Subscription quantities must be at least 1.');
  const plan = planById.get(item.planId);
  if (!plan || plan.active !== true) throw new Error(`Subscription plan "${item.planName}" is no longer active.`);
  const frequency = clean(plan.frequency).toLowerCase();
  if (!['monthly', 'quarterly', 'half_yearly', 'yearly'].includes(frequency)) throw new Error('Selected subscription plan is invalid.');
  const components = Array.isArray(p.components) ? p.components : [];
  if (!components.length || components.some((component: any) => !component?.productId)) {
   throw new Error(`Product "${p.name || item.name}" has no production product component.`);
  }
  const { price, packaging, selectedSellingOption, deliveries: regularDeliveries } = resolveSubscriptionPrice(p, plan, {
   sellingOptionId: item.sellingOptionId,
   packaging: item.packaging,
   planName: item.planName,
   displayName: item.name,
  });
  const entitlement=subscriptionEntitlements[subscriptionIndex];
  if (!entitlement) throw new Error('Subscription delivery entitlement could not be calculated.');
  const deliveries=entitlement.totalDeliveries;
  const delivery = deliveryCharges.subscriptions[subscriptionIndex];
  if (!delivery) throw new Error('Subscription delivery charges could not be calculated.');
  const weight = packaging * q;
  const first = subscriptionDate(item);
  const endDate = subscriptionEndDate(first, deliveries);
  const availability = await checkProductAvailability({
   product: { id: snap.id, ...p } as any,
   quantity: q,
   packagingGrams: packaging,
   deliveryDate: first,
  });
  availabilityResults.push(availability);
  const firstDeliveryWeightGrams = availability.hasShortage
   ? Math.max(0, Math.min(availability.availableGrams, availability.requestedGrams))
   : availability.requestedGrams;
  const subRef = doc(collection(db, 'subscriptions'));
  const orderRef = doc(collection(db, 'orders'));
  const subNo = `SUB-${subRef.id.slice(0, 8).toUpperCase()}`;
  const ordNo = orderNumber();
  const label = packaging >= 1000 && packaging % 1000 === 0 ? `${packaging / 1000}kg box` : `${packaging}g box`;
  const sellingOptionId = selectedSellingOption ? String(selectedSellingOption.id) : String(item.sellingOptionId || '');
  const orderSubtotal = price * q;
  const orderDeliveryFee = Number(delivery.termCharge || 0);
  const sub = {
   authUid,
   subscriptionNumber: subNo,
   customerId: mobile,
   customerName: clean(customer.name) || 'Unnamed customer',
   customerMobile: mobile,
   salableProductId: snap.id,
   productId: snap.id,
   productName: clean(p.name),
   sellingOptionId,
   sellingOptionLabel: label,
   packaging,
   weightGrams: weight,
   unitPrice: price,
   quantity: q,
   frequency,
   totalDeliveries: deliveries,
   regularDeliveries,
   bonusDeliveries: entitlement.bonusDeliveries,
   subscriptionOfferId: entitlement.offer?.id || '',
   subscriptionOfferName: entitlement.offer?.name || '',
   deliveriesGenerated: 0,
   nextDeliveryDate: first,
   deliveryDay: 6,
   startDate: first,
   endDate,
   deliveryAddress: address,
   deliveryFeePerDelivery: delivery.finalCharge,
   deliveryChargeDetails: delivery.snapshot,
   requiresCustomerContact: false,
   availabilityRequestedGrams: availability.requestedGrams,
   availabilityAvailableGrams: availability.availableGrams,
   availabilityShortageGrams: availability.shortageGrams,
   carryForwardQuantityGrams: availability.shortageGrams,
   availabilityDecision: 'continue',
   status: 'pending_payment',
   paymentStatus: 'pending',
   createdAt: serverTimestamp(),
   updatedAt: serverTimestamp(),
  };
  const ord = {
   authUid,
   orderNumber: ordNo,
   customerId: mobile,
   customerName: clean(customer.name),
   customerMobile: clean(customer.mobileNumber || customer.mobile || mobile),
   items: [{
    salableProductId: snap.id,
    salableProductType: p.type === 'multiple' ? 'multiple' : 'single',
    productId: snap.id,
    productName: clean(p.name),
    sellingOptionId,
    sellingOptionLabel: label,
    packaging,
    weightGrams: firstDeliveryWeightGrams,
    quantity: q,
    unitPrice: price,
    lineTotal: orderSubtotal,
    deliveryDate: first,
    imageUrl: clean(p.imageUrl),
   }],
   subtotal: orderSubtotal,
   deliveryFee: orderDeliveryFee,
   discount: 0,
   total: orderSubtotal + orderDeliveryFee,
   currency: 'INR',
   paymentStatus: 'pending',
   paymentMethod,
   status: 'pending_payment',
   deliveryAddress: address,
   scheduledDeliveryDate: first,
   deliveryDate: first,
   notes: '',
   orderType: 'subscription',
   subscriptionId: subRef.id,
   subscriptionNumber: subNo,
   subscriptionPlanId: item.planId,
   subscriptionPlanName: clean(plan.name) || frequency,
   subscriptionFrequency: frequency,
   deliveryChargeId: delivery.sourceId,
   deliveryChargeName: delivery.sourceName,
   deliveryChargeSnapshot: orderDeliveryFee,
   deliveryChargePerDelivery: delivery.perDeliveryCharge,
   deliveryChargeTerm: delivery.termCharge,
   deliveryChargeTermSavings: delivery.termSavings,
   deliveryChargeDetails: delivery.snapshot,
   packingStatus: 'pending',
   requiresCustomerContact: false,
   availabilityRequestedGrams: availability.requestedGrams,
   availabilityAvailableGrams: availability.availableGrams,
   availabilityShortageGrams: availability.shortageGrams,
   carryForwardQuantityGrams: availability.shortageGrams,
   availabilityDecision: 'continue',
   createdAt: serverTimestamp(),
   updatedAt: serverTimestamp(),
  };
  subscriptionWrites.push({ ref: subRef, data: sub, orderRef, order: ord });
 }
 const highDemandKeys:{key:string;thresholdGrams:number;committedDemandGrams:number}[]=[];
 input.oneTimeItems.forEach((item,index)=>{ if(availabilityResults[index]?.highDemand) highDemandKeys.push({key:`one-time:${item.productId}`,thresholdGrams:availabilityResults[index].thresholdGrams,committedDemandGrams:availabilityResults[index].committedDemandGrams}); });
 input.subscriptionItems.forEach((item,index)=>{ const result=availabilityResults[input.oneTimeItems.length+index]; if(result?.highDemand) highDemandKeys.push({key:`subscription:${item.productId}:${item.planId}:${item.startDate}`,thresholdGrams:result.thresholdGrams,committedDemandGrams:result.committedDemandGrams}); });
 if(highDemandKeys.length) throw new Error(`HIGH_DEMAND_ENQUIRY_REQUIRED:${JSON.stringify(highDemandKeys)}`);
 const hasShortage=availabilityResults.some(r=>r.hasShortage);
 if(hasShortage)throw new Error('DELIVERY_DATE_RECHECK_REQUIRED');
 const oneTimeDeliveryBase=deliveryCharges.oneTimeTotal; const offerResult=(input.oneTimeItems.length||input.subscriptionItems.length)&&geoId ? await calculateCustomerOffers({pincode:String((address as any).pincode||''),geoId,locationName:geoName,oneTimeSubtotal:oneSubtotal,subscriptionSubtotal:subscriptionWrites.reduce((sum,w)=>sum+Number(w.order.subtotal||0),0),deliveryChargeAmounts:checkoutDeliveryChargeAmounts(deliveryCharges)}) : {priceSavings:0,oneTimePriceSavings:0,subscriptionPriceSavings:0,deliverySavings:0,totalSavings:0};



 const oneTimeOrderGroups=new Map<string,Record<string,unknown>[]>();
 for(const item of oneOrders){const date=String(item.deliveryDate||targetDate);const group=oneTimeOrderGroups.get(date)||[];group.push(item);oneTimeOrderGroups.set(date,group);}
 const oneTimeDates=[...oneTimeOrderGroups.keys()].sort();
 const oneOrderWrites:{ref:ReturnType<typeof doc>;data:Record<string,unknown>}[]=[];
 // Offers and delivery charges are allocated by the shared rule also used by
 // the server total verification (lib/checkoutPricing.ts).
 const allocation=allocateCheckoutTotals({oneTimeGroups:oneTimeDates.map(date=>{const items=oneTimeOrderGroups.get(date)||[];return {date,subtotal:items.reduce((sum,item)=>sum+Number(item.lineTotal||0),0),mrpSubtotal:items.reduce((sum,item)=>sum+Number(item.mrp||item.unitPrice||0)*Number(item.quantity||0),0)};}),subscriptions:subscriptionWrites.map(w=>({subtotal:Number(w.order.subtotal||0),deliveryFee:Number(w.order.deliveryFee||0)})),deliveryCharges,offers:offerResult});
 subscriptionWrites.forEach((w,index)=>{ const allocated=allocation.subscriptions[index].allocated; const deliveryOfferSaving=allocation.subscriptions[index].deliveryOfferSaving; w.order.deliveryChargeOriginal=Number(w.order.deliveryFee||0); w.order.deliveryChargeSnapshot=allocation.subscriptions[index].deliveryFee; w.order.deliveryChargeTermSavings=deliveryOfferSaving; w.order.deliveryFee=allocation.subscriptions[index].deliveryFee; w.order.discount=allocated; w.order.total=allocation.subscriptions[index].total; w.order.offerDiscount=allocated+deliveryOfferSaving; w.order.offerPriceSavings=allocated; w.order.offerDeliverySavings=deliveryOfferSaving; w.order.offerPriceName=offerResult.priceOffer?.name||''; w.order.offerDeliveryName=offerResult.deliveryOffer?.name||''; w.order.offerTotalSavings=allocated+deliveryOfferSaving; });
 for(const [index,date] of oneTimeDates.entries()){
  const items=oneTimeOrderGroups.get(date)||[];
  const groupAmounts=allocation.oneTime[index];
  const groupSubtotal=groupAmounts.subtotal;
  const allocatedOffer=groupAmounts.allocatedOffer;
  const groupDeliveryFee=groupAmounts.deliveryFee;
  const groupDeliveryOfferSaving=groupAmounts.deliveryOfferSaving;
  const groupOfferTotalSaving=groupAmounts.offerTotalSaving;
  const groupMrpSaving=groupAmounts.mrpSaving;
  const ref=doc(collection(db,'orders'));
  const number=orderNumber();
  oneOrderWrites.push({ref,data:{authUid,orderNumber:number,customerId:mobile,customerName:clean(customer.name),customerMobile:clean(customer.mobileNumber||customer.mobile||mobile),items,subtotal:groupSubtotal,deliveryFee:groupDeliveryFee,discount:groupMrpSaving+allocatedOffer,total:Math.max(0,groupSubtotal-allocatedOffer)+groupDeliveryFee,currency:'INR',paymentStatus:'pending',paymentMethod,status:'pending_payment',deliveryAddress:address,scheduledDeliveryDate:date,deliveryDate:date,deliverySlot,notes:'',orderType:'one_time',subscriptionId:null,deliveryChargeId:deliveryCharges.oneTime.sourceId,deliveryChargeName:deliveryCharges.oneTime.sourceName,deliveryChargeSnapshot:groupDeliveryFee,deliveryChargeOriginal:index===0?oneTimeDeliveryBase:0,offerDiscount:groupOfferTotalSaving,offerPriceSavings:allocatedOffer,offerDeliverySavings:groupDeliveryOfferSaving,offerPriceName:offerResult.priceOffer?.name||'',offerDeliveryName:offerResult.deliveryOffer?.name||'',offerTotalSavings:groupOfferTotalSaving,deliveryChargeWaivedBySubscription:false,deliveryChargeDetails:deliveryCharges.oneTime.snapshot,packingStatus:'pending',requiresCustomerContact:false,availabilityDecision:'continue',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}});
 }
 // One pending checkout per customer (server-enforced): the same purchase resumes
 // its existing records; new records carry the claim token and are registered.
 const claim=await beginCheckoutClaim(mobile,summaryFromOrders([...oneOrderWrites.map(w=>w.data),...subscriptionWrites.map(w=>w.order)]));
 if(claim.action==='resume')return resumedMixedCheckoutResult(claim.resume);
 for(const w of oneOrderWrites)w.data.checkoutClaimToken=claim.token;
 for(const w of subscriptionWrites){w.data.checkoutClaimToken=claim.token;w.order.checkoutClaimToken=claim.token;}
 const batch=writeBatch(db);for(const w of oneOrderWrites)batch.set(w.ref,w.data);for(const w of subscriptionWrites){batch.set(w.ref,w.data);batch.set(w.orderRef,w.order);}await batch.commit();
 await registerCheckoutClaim({mobile,token:claim.token,orderIds:[...oneOrderWrites.map(w=>w.ref.id),...subscriptionWrites.map(w=>w.orderRef.id)],subscriptionIds:subscriptionWrites.map(w=>w.ref.id)});
 const oneOrderIds=oneOrderWrites.map(w=>w.ref.id);const oneOrderNumbers=oneOrderWrites.map(w=>String(w.data.orderNumber||''));const paymentOrderIds=[...oneOrderIds,...subscriptionWrites.map(w=>w.orderRef.id)];
 const checkoutTotal=[...allocation.oneTime,...allocation.subscriptions].reduce((sum,order)=>sum+order.total,0);
 return {oneTimeOrderId:oneOrderIds[0]||'',oneTimeOrderIds:oneOrderIds,oneTimeOrderNumber:oneOrderNumbers[0]||'',oneTimeOrderNumbers:oneOrderNumbers,subscriptionOrderIds:subscriptionWrites.map(w=>w.orderRef.id),subscriptionNumbers:subscriptionWrites.map(w=>String(w.data.subscriptionNumber)),subscriptionIds:subscriptionWrites.map(w=>w.ref.id),paymentOrderIds,total:checkoutTotal,primaryOrderNumber:oneOrderNumbers[0]||String(subscriptionWrites[0]?.order.orderNumber||''),primaryOrderId:oneOrderIds[0]||subscriptionWrites[0]?.orderRef.id||''};
}
