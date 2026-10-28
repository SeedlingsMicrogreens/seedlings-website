import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App | undefined;

function getFirebaseAdminApp() {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    try {
      const credentials = JSON.parse(serviceAccountJson) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing required service-account fields.');
      }
      app = initializeApp({
        credential: cert({
          projectId: credentials.project_id,
          clientEmail: credentials.client_email,
          privateKey: credentials.private_key.replace(/\\n/g, '\n'),
        }),
      });
      return app;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
      throw error;
    }
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim();

  if (!clientEmail && !privateKey) {
    // No key configured: use the runtime's own Google service account (Application Default Credentials).
    // On Firebase App Hosting / Cloud Run this is the backend's service account, so no private key is stored.
    // Locally, set the key variables in .env.local or run `gcloud auth application-default login`.
    app = initializeApp({
      credential: applicationDefault(),
      projectId: projectId || process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
    });
    return app;
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin credentials are incomplete. Set all of FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY, or none of them to use the runtime service account.');
  }

  app = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });
  return app;
}

export function adminAuth(): Auth { return getAuth(getFirebaseAdminApp()); }
export function adminDb(): Firestore { return getFirestore(getFirebaseAdminApp()); }
