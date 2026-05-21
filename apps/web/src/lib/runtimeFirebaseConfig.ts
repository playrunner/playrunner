import type {FirebaseOptions} from 'firebase/app';

export const RUNTIME_FIREBASE_CONFIG_STORAGE_KEY = 'playrunner.runtime.firebaseConfig';

export type RuntimeFirebaseConfig = FirebaseOptions & {
  appId: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  measurementId?: string;
  messagingSenderId: string;
  projectId: string;
  storageBucket: string;
};

function isBrowser() {
  return typeof window !== 'undefined';
}

export function getRuntimeFirebaseConfig(): RuntimeFirebaseConfig | null {
  if (!isBrowser()) return null;

  const raw = window.localStorage.getItem(RUNTIME_FIREBASE_CONFIG_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as RuntimeFirebaseConfig;
  } catch {
    return null;
  }
}
