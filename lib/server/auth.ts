import { adminAuth } from '@/lib/server/firebaseAdmin';
import { HttpError } from '@/lib/server/httpError';

export async function requireFirebaseUser(request: Request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, 'Authentication is required.');
  try {
    return await adminAuth().verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, 'Your login session is invalid or expired.');
  }
}
