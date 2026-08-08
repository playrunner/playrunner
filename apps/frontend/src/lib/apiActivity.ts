import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let pendingRequestCount = 0;

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function trackApiActivity<T>(request: () => Promise<T>) {
  pendingRequestCount += 1;
  emitChange();

  try {
    return await request();
  } finally {
    pendingRequestCount = Math.max(0, pendingRequestCount - 1);
    emitChange();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return pendingRequestCount;
}

export function usePendingApiRequestCount() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
