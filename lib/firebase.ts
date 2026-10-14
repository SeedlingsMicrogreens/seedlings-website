import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local Firebase Emulator Suite (development/testing only; inactive unless both
// variables are set, never in production configuration).
const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
const firestoreEmulatorHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
const emulatorFlag = '__seedlingsFirebaseEmulatorsConnected';
if (authEmulatorHost && firestoreEmulatorHost && !(globalThis as Record<string, unknown>)[emulatorFlag]) {
  (globalThis as Record<string, unknown>)[emulatorFlag] = true;
  connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
  const [host, port] = firestoreEmulatorHost.split(':');
  connectFirestoreEmulator(db, host, Number(port));
}

export const authPersistenceReady = typeof window === 'undefined'
  ? Promise.resolve()
  : setPersistence(auth, browserLocalPersistence);
