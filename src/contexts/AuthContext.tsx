import React, { createContext, useContext, useState, useCallback } from 'react';
import { changePin as apiChangePin, verifyPin } from '../lib/adminAuth';
import type { AdminUser } from '../lib/types';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  currentUser: Pick<AdminUser, 'id' | 'username' | 'displayName' | 'role' | 'mustChangePin'> | null;
  login: (username: string, pin: string) => Promise<'ok' | 'wrong_pin' | 'locked' | 'error'>;
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

  // Admin users are seeded server-side; the browser cannot write to adminUsers.

  const login = useCallback(async (username: string, pin: string): Promise<'ok' | 'wrong_pin' | 'locked' | 'error'> => {
    const result = await verifyPin(username, pin);
    if (result.status === 'ok') {
      // The response carries only safe fields — there is no PIN to leak here.
      setCurrentUser(result.user);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
      return 'ok';
    }
    // A wrong PIN and an unknown username look identical on purpose, so the
    // login screen cannot be used to discover which usernames exist.
    if (result.status === 'invalid') return 'wrong_pin';
    if (result.status === 'locked') return 'locked';
    return 'error';
  }, []);

  const logout = useCallback(() => {
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
    <AuthContext.Provider value={{ isAdminAuthenticated, currentUser, login, logout, changePin, changePinLegacy }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
