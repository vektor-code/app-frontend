const MOCK_PREFIX = 'apm-mock.';

export type MockUser = {
  username: string;
  displayName: string;
  role: 'admin';
  email: string;
};

function hostIsLocal(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function isLocalMockAuth(): boolean {
  return hostIsLocal();
}

export function shouldUseMockTelemetry(): boolean {
  if (!isLocalMockAuth()) return false;
  try {
    return isMockToken(localStorage.getItem('token'));
  } catch {
    return false;
  }
}

export function isMockToken(token: string | null | undefined): token is string {
  return Boolean(token?.startsWith(MOCK_PREFIX));
}

function encodePayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePayload<T>(token: string): T | null {
  try {
    const raw = token.slice(MOCK_PREFIX.length);
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export function createMockSession(username: string) {
  const name = username.trim() || 'admin';
  const user: MockUser = {
    username: name,
    displayName: name,
    role: 'admin',
    email: `${name}@localhost`,
  };
  const token = `${MOCK_PREFIX}${encodePayload({
    user,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })}`;
  return { token, user, expires_in: 7 * 24 * 60 * 60 };
}

export function mockUserFromToken(token: string): MockUser | null {
  const payload = decodePayload<{ user?: MockUser }>(token);
  return payload?.user ?? null;
}

export const MOCK_LICENSE = {
  valid: true as const,
  status: 'valid',
  expires_at: null,
};
