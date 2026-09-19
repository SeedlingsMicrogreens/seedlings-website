import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { HttpError } from './httpError';

function isManagedRuntime() {
  return Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.GAE_ENV);
}

function initializeFirebaseAdminApp() {
  if (getApps().length) return getApps()[0];

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || '';
  if (serviceAccountJson) {
    let parsed: { project_id?: string; client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(serviceAccountJson) as { project_id?: string; client_email?: string; private_key?: string };
    } catch {
      throw new HttpError(500, 'Server Firebase credentials are invalid JSON.');
    }

    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new HttpError(500, 'Server Firebase credentials are missing required fields.');
    }

    return initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, '\n'),
      }),
    });
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || '';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || '';
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim() || '';
  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }

  if (isManagedRuntime()) {
    return initializeApp();
  }

  throw new HttpError(
    500,
    'Server Firebase credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_ADMIN_* variables.'
  );
}

export function getAdminAuth() {
  const app = initializeFirebaseAdminApp();
  return getAuth(app);
}

export function getAdminDb() {
  const app = initializeFirebaseAdminApp();
  return getFirestore(app);
}
