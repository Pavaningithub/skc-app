// ─── Agent auth client ───────────────────────────────────────────────────────
// Agent PINs live in the agents collection, which is closed to clients, so
// verification runs in the adminAuth Cloud Function and the browser signs in
// with the custom token it returns.

import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from './firebase';
import type { Agent } from './types';

const REGION = 'asia-south1';

function baseUrl(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('VITE_FIREBASE_PROJECT_ID is not set.');
  return `https://${REGION}-${projectId}.cloudfunctions.net/adminAuth`;
}

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ...data, _status: res.status };
}

export type AgentLoginResult =
  | { status: 'ok'; agent: Agent }
  | { status: 'invalid' }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'error'; message: string };

async function handle(data: Record<string, unknown>): Promise<AgentLoginResult> {
  if (data.ok === true && data.agent) {
    if (typeof data.token === 'string') {
      await signInWithCustomToken(auth, data.token);
    }
    return { status: 'ok', agent: data.agent as Agent };
  }
  if (data.reason === 'locked') {
    return { status: 'locked', retryAfterSeconds: Number(data.retryAfterSeconds ?? 900) };
  }
  if (data._status === 401) return { status: 'invalid' };
  return { status: 'error', message: String(data.error ?? 'Could not reach the login service.') };
}

export async function verifyAgentPin(agentCode: string, pin: string): Promise<AgentLoginResult> {
  try {
    return await handle(await call('agent/verify', { agentCode, pin }));
  } catch {
    return { status: 'error', message: 'Could not reach the login service.' };
  }
}

export async function changeAgentPin(
  agentCode: string, currentPin: string, newPin: string,
): Promise<AgentLoginResult> {
  try {
    return await handle(await call('agent/change-pin', { agentCode, currentPin, newPin }));
  } catch {
    return { status: 'error', message: 'Could not reach the login service.' };
  }
}

export async function signOutAgent(): Promise<void> {
  await signOut(auth).catch(() => {/* already signed out */});
}
