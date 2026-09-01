import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { changePin as apiChangePin, signOutAdmin, verifyPin } from '../lib/adminAuth';
import type { AdminUser } from '../lib/types';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  /**
   * False until Firebase has restored (or confirmed the absence of) a session.
   * Firestore reads made before this are anonymous and the rules reject them,
   * so admin screens must wait rather than querying on mount.
   */
  authReady: boolean;
  currentUser: Pick<AdminUser, 'id' | 'username' | 'displayName' | 'role' | 'mustChangePin'> | null;
  login: (username: string, pin: string) => Promise<
    { status: 'ok' | 'wrong_pin' | 'locked' } | { status: 'error'; message: string }>;
  logout: () => void;
  changePin: (currentPin: string, newPin: string) => Promise<void>;
  /** Legacy single-PIN change — kept for SettingsPage compatibility */
  changePinLegacy: (oldPin: string, newPin: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const SESSION_KEY = 'skc_auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthContextType['currentUser']>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const isAdminAuthenticated = currentUser !== null;
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, user => {
    // A stored app session without a Firebase one means the sign-in was lost
    // (cleared storage, expired refresh token) — every query would be denied,
    // so drop the app session and send them back to the PIN screen.
    if (!user) setCurrentUser(prev => (prev ? null : prev));
    setAuthReady(true);
  }), []);

  // Admin users are seeded server-side; the browser cannot write to adminUsers.

  const login = useCallback(async (username: string, pin: string) => {
    const result = await verifyPin(username, pin);
    if (result.status === 'ok') {
      // The response carries only safe fields — there is no PIN to leak here.
      setCurrentUser(result.user);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
      return { status: 'ok' as const };
    }
    // A wrong PIN and an unknown username look identical on purpose, so the
    // login screen cannot be used to discover which usernames exist.
    if (result.status === 'invalid') return { status: 'wrong_pin' as const };
    if (result.status === 'locked') return { status: 'locked' as const };
    // Anything else carries the server's own explanation; showing a generic
    // "check your connection" here hides real faults (a 500, a bad route, an
    // IAM permission the token minting needs) behind a wrong diagnosis.
    return { status: 'error' as const, message: result.message };
  }, []);

  const logout = useCallback(() => {
    void signOutAdmin();
    setCurrentUser(null);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('skc_auth'); // clear legacy key too
  }, []);

  const changePin = useCallback(async (currentPin: string, newPin: string) => {
    const username = currentUser?.username;
    if (!username) throw new Error('Not signed in.');
    const result = await apiChangePin(username, currentPin, newPin);
    if (!result.ok) throw new Error(result.message);
    setCurrentUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, mustChangePin: false };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [currentUser]);

  const changePinLegacy = useCallback(async (oldPin: string, newPin: string): Promise<boolean> => {
    if (!currentUser) return false;
    const result = await apiChangePin(currentUser.username, oldPin, newPin);
    return result.ok;
  }, [currentUser]);

  return (
    <AuthContext.Provider value={{ isAdminAuthenticated, authReady, currentUser, login, logout, changePin, changePinLegacy }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
