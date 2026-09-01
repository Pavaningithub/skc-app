// ─── Admin authentication ────────────────────────────────────────────────────
// PIN verification runs here, server-side, so admin PINs never reach a browser
// and the adminUsers collection can stay closed to every client.
//
// This endpoint is necessarily public — it is what you call *before* logging in.
// A 4-digit PIN is only 10,000 combinations, so failed attempts are counted and
// the account is locked out briefly once too many pile up.

import * as admin from "firebase-admin";
import type {Request} from "firebase-functions/v2/https";
import type {Response} from "express";

const USERS = "adminUsers";
const AGENTS = "agents";
const THROTTLE = "authThrottle";

/** Failed attempts allowed before a lockout kicks in. */
export const MAX_ATTEMPTS = 5;
/** How long a lockout lasts, and the window failures are counted over. */
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Mint a Firebase custom token carrying the caller's role. Signing in with it
 * gives Firestore rules an identity (request.auth.token.admin / .agent) — which
 * is the only way a rule can tell an admin's browser from a stranger's.
 */
async function mintToken(
  uid: string, claims: Record<string, unknown>,
): Promise<string> {
  try {
    return await admin.auth().createCustomToken(uid, claims);
  } catch (err) {
    // createCustomToken signs a JWT via the IAM API, which needs
    // iam.serviceAccounts.signBlob — a permission the default compute service
    // account does not have until it is granted Service Account Token Creator
    // on itself. Nothing about the request causes this, so say so rather than
    // letting it surface as a generic 500.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      "Could not mint a sign-in token. The Cloud Functions service account is " +
      "probably missing the Service Account Token Creator role " +
      "(iam.serviceAccounts.signBlob). Grant it on the service account itself " +
      `in IAM & Admin, then retry. Underlying error: ${detail}`,
    );
  }
}

export interface PublicAdminUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePin: boolean;
}

interface StoredUser extends PublicAdminUser {
  pin?: string;
}

/** Strip the PIN — the shape that is safe to send to a browser. */
function publicUser(id: string, data: FirebaseFirestore.DocumentData): PublicAdminUser {
  return {
    id,
    username: String(data.username ?? ""),
    displayName: String(data.displayName ?? ""),
    role: String(data.role ?? "operator"),
    mustChangePin: data.mustChangePin === true,
  };
}

async function findByUsername(
  db: admin.firestore.Firestore, username: string,
): Promise<{id: string; data: StoredUser} | null> {
  const snap = await db.collection(USERS)
    .where("username", "==", username.trim().toLowerCase()).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return {id: doc.id, data: {...publicUser(doc.id, doc.data()), pin: doc.data().pin as string}};
}

// ─── Throttling ──────────────────────────────────────────────────────────────

interface ThrottleState {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

async function readThrottle(
  db: admin.firestore.Firestore, key: string,
): Promise<ThrottleState> {
  const snap = await db.collection(THROTTLE).doc(key).get();
  const d = snap.exists ? snap.data() ?? {} : {};
  return {
    failures: Number(d.failures ?? 0),
    firstFailureAt: Number(d.firstFailureAt ?? 0),
    lockedUntil: Number(d.lockedUntil ?? 0),
  };
}

/** Seconds remaining on a lockout, or 0 when the account is not locked. */
export function lockoutRemaining(state: ThrottleState, now: number): number {
  return state.lockedUntil > now ? Math.ceil((state.lockedUntil - now) / 1000) : 0;
}

async function recordFailure(
  db: admin.firestore.Firestore, key: string, now: number,
): Promise<void> {
  const state = await readThrottle(db, key);
  // Failures older than the window start a fresh count.
  const withinWindow = now - state.firstFailureAt < LOCKOUT_MS;
  const failures = withinWindow ? state.failures + 1 : 1;
  await db.collection(THROTTLE).doc(key).set({
    failures,
    firstFailureAt: withinWindow ? state.firstFailureAt || now : now,
    lockedUntil: failures >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0,
    updatedAt: new Date(now).toISOString(),
  });
}

async function clearFailures(db: admin.firestore.Firestore, key: string): Promise<void> {
  await db.collection(THROTTLE).doc(key).delete().catch(() => {/* nothing to clear */});
}

// ─── Routes ──────────────────────────────────────────────────────────────────

function isPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4,6}$/.test(value);
}

/**
 * Create the owner account if the collection is empty, so a fresh project is
 * not locked out. Only Pavan — the browser can no longer write to adminUsers,
 * and additional accounts are created deliberately rather than by a seed.
 */
async function seedIfEmpty(
  db: admin.firestore.Firestore, defaultPin: string,
): Promise<void> {
  const existing = await db.collection(USERS).limit(1).get();
  if (!existing.empty) return;
  const iso = new Date().toISOString();
  await db.collection(USERS).doc("user_pavan").set({
    username: "pavan",
    displayName: "Pavan",
    role: "owner",
    pin: defaultPin,
    mustChangePin: true,
    createdAt: iso,
    updatedAt: iso,
  });
}

export async function serveAuth(
  req: Request, res: Response, db: admin.firestore.Firestore,
  defaultPin = "1234",
): Promise<void> {
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const path = (req.path || "/").replace(/^\/+|\/+$/g, "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = Date.now();

  try {
    // The login screen needs names to show; it must never receive PINs.
    if (path === "users" || path === "") {
      await seedIfEmpty(db, defaultPin);
      const snap = await db.collection(USERS).get();
      res.status(200).json({
        users: snap.docs.map((d) => publicUser(d.id, d.data()))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      });
      return;
    }

    if (path === "verify" || path === "change-pin") {
      if (req.method !== "POST") {
        res.status(405).json({error: "Use POST."});
        return;
      }
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!username) {
        res.status(400).json({error: "\"username\" is required."});
        return;
      }

      const throttle = await readThrottle(db, username);
      const locked = lockoutRemaining(throttle, now);
      if (locked > 0) {
        res.status(429).json({
          ok: false, reason: "locked", retryAfterSeconds: locked,
          error: `Too many wrong PINs. Try again in ${Math.ceil(locked / 60)} minute(s).`,
        });
        return;
      }

      const found = await findByUsername(db, username);
      const supplied = path === "verify" ? body.pin : body.currentPin;
      // Same failure path whether the user is missing or the PIN is wrong, so
      // this cannot be used to enumerate which usernames exist.
      if (!found || typeof supplied !== "string" || supplied !== found.data.pin) {
        await recordFailure(db, username, now);
        res.status(401).json({ok: false, reason: "invalid", error: "Wrong username or PIN."});
        return;
      }

      await clearFailures(db, username);

      if (path === "verify") {
        const {pin: _pin, ...user} = found.data;
        void _pin;
        const token = await mintToken(found.id, {
          admin: true, role: user.role, username: user.username,
        });
        res.status(200).json({ok: true, user, token});
        return;
      }

      if (!isPin(body.newPin)) {
        res.status(400).json({error: "\"newPin\" must be 4 to 6 digits."});
        return;
      }
      if (body.newPin === supplied) {
        res.status(400).json({error: "The new PIN must be different from the current one."});
        return;
      }
      await db.collection(USERS).doc(found.id).update({
        pin: body.newPin,
        mustChangePin: false,
        updatedAt: new Date(now).toISOString(),
      });
      res.status(200).json({ok: true, changed: true});
      return;
    }

    // ── Agents ───────────────────────────────────────────────────────────────
    // Agent PINs live in the agents collection, which is now closed to clients,
    // so agent login runs here as well.
    if (path === "agent/verify" || path === "agent/change-pin") {
      if (req.method !== "POST") {
        res.status(405).json({error: "Use POST."});
        return;
      }
      const code = String(body.agentCode ?? "").trim().toUpperCase();
      if (!code) {
        res.status(400).json({error: "\"agentCode\" is required."});
        return;
      }
      const throttleKey = `agent:${code}`;
      const state = await readThrottle(db, throttleKey);
      const held = lockoutRemaining(state, now);
      if (held > 0) {
        res.status(429).json({
          ok: false, reason: "locked", retryAfterSeconds: held,
          error: `Too many wrong PINs. Try again in ${Math.ceil(held / 60)} minute(s).`,
        });
        return;
      }

      const snap = await db.collection(AGENTS)
        .where("agentCode", "==", code).limit(1).get();
      const doc = snap.empty ? null : snap.docs[0];
      const data = doc?.data();
      const supplied = path === "agent/verify" ? body.pin : body.currentPin;

      if (!doc || !data || data.isActive === false ||
          typeof supplied !== "string" || supplied !== data.pin) {
        await recordFailure(db, throttleKey, now);
        res.status(401).json({ok: false, reason: "invalid", error: "Wrong agent code or PIN."});
        return;
      }
      await clearFailures(db, throttleKey);

      const {pin: _agentPin, ...agent} = data;
      void _agentPin;

      if (path === "agent/verify") {
        const token = await mintToken(doc.id, {agent: true, agentId: doc.id});
        res.status(200).json({ok: true, agent: {id: doc.id, ...agent}, token});
        return;
      }

      if (!isPin(body.newPin)) {
        res.status(400).json({error: "\"newPin\" must be 4 to 6 digits."});
        return;
      }
      await db.collection(AGENTS).doc(doc.id).update({
        pin: body.newPin, mustChangePin: false, updatedAt: new Date(now).toISOString(),
      });
      const token = await mintToken(doc.id, {agent: true, agentId: doc.id});
      res.status(200).json({ok: true, changed: true, agent: {id: doc.id, ...agent}, token});
      return;
    }

    res.status(404).json({error: `Unknown route "${path}".`});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : "Unexpected error."});
  }
}
