import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

function createFirestoreDb() {
  try {
    return initializeFirestore(
      app,
      { experimentalForceLongPolling: true },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreDb();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
export const FIREBASE_OAUTH_CLIENT_ID = firebaseConfig.oAuthClientId || '';

let authPrewarmed = false;
export function prewarmGoogleAuth(): void {
  if (typeof window === 'undefined' || authPrewarmed) return;
  authPrewarmed = true;
  void auth.authStateReady().catch(() => {});
  if (firebaseConfig.authDomain) {
    const base = `https://${firebaseConfig.authDomain}`;
    void fetch(`${base}/__/auth/handler`, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {});
    void fetch(`${base}/__/auth/iframe`, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {});
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isOfflineConnectionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    code === 'unavailable' ||
    msg.includes('the client is offline') ||
    msg.includes('could not reach cloud firestore backend')
  );
}

async function testFirestoreConnection(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const probe = () => getDocFromServer(doc(db, 'counters', 'tool'));
  try {
    await probe();
  } catch (firstError) {
    if (!isOfflineConnectionError(firstError)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      await probe();
    } catch (retryError) {
      if (isOfflineConnectionError(retryError)) {
        console.error('Please check your Firebase configuration.');
      }
    }
  }
}

void testFirestoreConnection();
