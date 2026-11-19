import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// CRITICAL: Bind to the provisioned named Firestore database from firebase-applet-config.json
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Persist auth sessions reliably across browser refreshes
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Unable to set Firebase local auth persistence:', err);
});

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

export function formatReadableFirestoreError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('Quota exceeded')) {
    return 'Firestore daily free-tier quota has been reached. Quota resets the next day.';
  }
  if (raw.includes('permission-denied') || raw.includes('Missing or insufficient permissions')) {
    return 'Access denied by Firestore Security Rules. Please confirm you are signed in with a verified Google account.';
  }
  if (raw.includes('offline') || raw.includes('network')) {
    return 'Unable to reach Cloud Firestore right now. Please check your internet connection and retry.';
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed.error) {
      if (parsed.error.includes('permission-denied') || parsed.error.includes('insufficient permissions')) {
        return 'Permission denied by Firestore Security Rules. Only the authenticated account owner can access or modify these trips.';
      }
      return parsed.error;
    }
  } catch {
    // Plain string error
  }
  return raw || 'An unexpected Cloud Firestore error occurred.';
}

export function formatReadableAuthError(error: unknown): {
  cancelled: boolean;
  message: string;
} {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      cancelled: true,
      message: 'Google sign-in was cancelled. You can continue exploring or try signing in again anytime.',
    };
  }
  if (code === 'auth/popup-blocked') {
    return {
      cancelled: false,
      message:
        'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.',
    };
  }
  if (code === 'auth/unauthorized-domain') {
    return {
      cancelled: false,
      message:
        'This domain is not listed under Firebase Authentication → Settings → Authorized domains yet.',
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      cancelled: false,
      message: 'Network error during Google sign-in. Please check your connection and try again.',
    };
  }
  const fallback = error instanceof Error ? error.message : 'Unable to complete Google sign-in.';
  return { cancelled: false, message: fallback };
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutFirebase() {
  return signOut(auth);
}

// Startup connectivity validation per Firebase integration guidelines
async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: Cloud Firestore client is offline.');
    }
  }
}

void testConnection();
