import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-config.json';
import { getRuntimeFirebaseConfig } from './runtimeFirebaseConfig';

type FirebaseConfigFile = Partial<FirebaseOptions> & {
  firestoreDatabaseId?: string;
};

const FALLBACK_FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: 'setup-placeholder-api-key',
  appId: '1:000000000000:web:setupplaceholder',
  authDomain: 'setup-placeholder.firebaseapp.com',
  messagingSenderId: '000000000000',
  projectId: 'setup-placeholder',
  storageBucket: 'setup-placeholder.firebasestorage.app',
};

function isConfiguredFirebaseOptions(config: Partial<FirebaseOptions> | null | undefined): config is FirebaseOptions {
  return Boolean(
    config?.apiKey &&
    config?.appId &&
    config?.authDomain &&
    config?.messagingSenderId &&
    config?.projectId &&
    config?.storageBucket,
  );
}

const fileFirebaseConfig = firebaseConfig as FirebaseConfigFile;
const runtimeFirebaseConfig = getRuntimeFirebaseConfig();
const firebaseAppConfig = isConfiguredFirebaseOptions(runtimeFirebaseConfig)
  ? runtimeFirebaseConfig
  : isConfiguredFirebaseOptions(fileFirebaseConfig)
    ? fileFirebaseConfig
    : FALLBACK_FIREBASE_CONFIG;
const firestoreDatabaseId =
  runtimeFirebaseConfig?.firestoreDatabaseId || fileFirebaseConfig.firestoreDatabaseId;

export const app = initializeApp(firebaseAppConfig);
export const auth = getAuth(app);
export const db = firestoreDatabaseId
  ? getFirestore(app, firestoreDatabaseId)
  : getFirestore(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
