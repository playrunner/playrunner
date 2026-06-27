const AUTH_STORAGE_KEY = 'playrunner.localAuthSession';

type StoredAuthUser = {
  email?: string | null;
  uid: string;
  username: string;
  name?: string | null;
};

type StoredAuthSession = {
  token: string;
  user: StoredAuthUser;
};

export type LocalAuthUser = StoredAuthUser & {
  email: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  getIdToken: () => Promise<string>;
};

type AuthStateListener = (user: LocalAuthUser | null) => void;

function isBrowser() {
  return typeof window !== 'undefined';
}

class LocalAuth {
  currentUser: LocalAuthUser | null = null;
  private token = '';
  private listeners = new Set<AuthStateListener>();

  constructor() {
    this.restoreFromStorage();

    if (isBrowser()) {
      window.addEventListener('storage', this.handleStorageEvent);
    }
  }

  private handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== AUTH_STORAGE_KEY) {
      return;
    }

    this.restoreFromStorage(true);
  };

  private createUser(user: StoredAuthUser): LocalAuthUser {
    const email =
      user.email ?? (user.username.includes('@') ? user.username : null);

    return {
      ...user,
      email,
      emailVerified: true,
      isAnonymous: false,
      name: user.name ?? user.username,
      tenantId: null,
      getIdToken: async () => this.token,
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener(this.currentUser));
  }

  private readStoredSession(): StoredAuthSession | null {
    if (!isBrowser()) {
      return null;
    }

    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StoredAuthSession;
      if (!parsed?.token || !parsed?.user?.uid || !parsed?.user?.username) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private persistSession(session: StoredAuthSession | null) {
    if (!isBrowser()) {
      return;
    }

    if (!session) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  }

  private applySession(session: StoredAuthSession | null, shouldNotify = true) {
    this.token = session?.token ?? '';
    this.currentUser = session ? this.createUser(session.user) : null;

    if (shouldNotify) {
      this.notify();
    }
  }

  private restoreFromStorage(shouldNotify = false) {
    this.applySession(this.readStoredSession(), shouldNotify);
  }

  onAuthStateChanged(listener: AuthStateListener) {
    this.listeners.add(listener);
    listener(this.currentUser);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async signInWithPassword(username: string, password: string) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      token?: string;
      user?: StoredAuthUser;
    } | null;

    if (!response.ok || !payload?.token || !payload?.user) {
      throw new Error(payload?.error ?? 'Login failed.');
    }

    const session: StoredAuthSession = {
      token: payload.token,
      user: payload.user,
    };

    this.persistSession(session);
    this.applySession(session);

    return this.currentUser;
  }

  async validateSession() {
    if (!this.token) {
      return this.currentUser;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        await this.signOut();
        return null;
      }

      if (!response.ok) {
        return this.currentUser;
      }

      const payload = (await response.json().catch(() => null)) as {
        user?: StoredAuthUser;
      } | null;

      if (!payload?.user?.uid || !payload.user.username) {
        await this.signOut();
        return null;
      }

      const session: StoredAuthSession = {
        token: this.token,
        user: payload.user,
      };

      this.persistSession(session);
      this.applySession(session);

      return this.currentUser;
    } catch {
      return this.currentUser;
    }
  }

  async signOut() {
    this.persistSession(null);
    this.applySession(null);
  }
}

export const auth = new LocalAuth();

export function signInWithPassword(username: string, password: string) {
  return auth.signInWithPassword(username, password);
}
