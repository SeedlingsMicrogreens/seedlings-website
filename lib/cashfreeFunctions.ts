import { auth } from '@/lib/firebase';

type CreateCashfreeOrderResult = {
  cashfreeOrderId: string;
  paymentSessionId: string;
  amount: number;
};

type CashfreePaymentResult = {
  status: 'paid' | 'failed' | 'pending';
  cashfreeOrderId: string;
  orderNumber: string;
  orderNumbers: string[];
  paymentId?: string;
  message: string;
};

type RouteErrorResponse = { message?: string };

async function postWithAuth<TResponse>(url: string, payload: unknown, fallbackMessage: string): Promise<TResponse> {
  if (!auth.currentUser) throw new Error('Your login session expired. Please sign in again.');

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  let data: TResponse | RouteErrorResponse | null = null;
  try {
    data = (await response.json()) as TResponse | RouteErrorResponse;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as RouteErrorResponse).message || '')
      : '';
    throw new Error(message || fallbackMessage);
  }

  return data as TResponse;
}

export async function createCashfreeOrder(orderIds: string[], customerMobile: string) {
  return postWithAuth<CreateCashfreeOrderResult>(
    '/api/cashfree/create-order',
    { orderIds, customerMobile },
    'Payment setup failed. Please try again.'
  );
}

export async function completeCashfreePayment(orderId: string) {
  return postWithAuth<CashfreePaymentResult>(
    '/api/cashfree/complete',
    { orderId },
    'Payment verification failed. Please try again.'
  );
}
