// ─── Admin auth client ───────────────────────────────────────────────────────
// Talks to the adminAuth Cloud Function. PINs are checked there, never here —
// the browser only ever sends a PIN and receives a yes/no plus the safe fields
// of the user record.

import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from './firebase';
import type { AdminUser } from './types';

export type PublicAdminUser = Pick<AdminUser, 'id' | 'username' | 'displayName' | 'role' | 'mustChangePin'>;

const REGION = 'asia-south1';

function baseUrl(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('VITE_FIREBASE_PROJECT_ID is not set.');
  return `https://${REGION}-${projectId}.cloudfunctions.net/adminAuth`;
}

async function call(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ...data, _status: res.status };
}

/** Names for the login screen. Never includes PINs. */
export async function listAdminUsers(): Promise<PublicAdminUser[]> {
  const data = await call('users');
  return Array.isArray(data.users) ? (data.users as PublicAdminUser[]) : [];
}

export type LoginResult =
  | { status: 'ok'; user: PublicAdminUser }
  | { status: 'invalid' }
  | { status: 'locked'; retryAfterSeconds: number }
  /** message is the server's own wording where there is one — do not replace it. */
  | { status: 'error'; message: string };

export async function verifyPin(username: string, pin: string): Promise<LoginResult> {
  try {
    const data = await call('verify', { username, pin });
    if (data.ok === true && data.user) {
      // Signing in with the custom token is what gives Firestore rules an
      // identity to check — without it every admin read stays anonymous.
      if (typeof data.token === 'string') {
        await signInWithCustomToken(auth, data.token);
      }
      return { status: 'ok', user: data.user as PublicAdminUser };
    }
    if (data.reason === 'locked') {
      return { status: 'locked', retryAfterSeconds: Number(data.retryAfterSeconds ?? 900) };
    }
    if (data._status === 401) return { status: 'invalid' };
    return {
      status: 'error',
      message: String(data.error ?? `Login service returned HTTP ${data._status}.`),
    };
  } catch (err) {
    // Only a thrown fetch is genuinely a connectivity problem; a server error
    // has a message worth showing, and is handled above.
    return {
      status: 'error',
      message: `Could not reach the login service (${err instanceof Error ? err.message : 'network error'}).`,
    };
  }
}

/** Ends the Firebase session as well as the app's own. */
export async function signOutAdmin(): Promise<void> {
  await signOut(auth).catch(() => {/* already signed out */});
}

export async function changePin(
  username: string, currentPin: string, newPin: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const data = await call('change-pin', { username, currentPin, newPin });
    if (data.ok === true) return { ok: true };
    return { ok: false, message: String(data.error ?? 'Could not change the PIN.') };
  } catch {
    return { ok: false, message: 'Could not reach the login service.' };
  }
}
