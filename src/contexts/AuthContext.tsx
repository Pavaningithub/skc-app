import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { adminUsersService } from '../lib/services';
import { DEFAULT_ADMIN_PIN } from '../lib/constants';
import type { AdminUser } from '../lib/types';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  currentUser: Pick<AdminUser, 'id' | 'username' | 'displayName' | 'role' | 'mustChangePin'> | null;
  login: (username: string, pin: string) => Promise<'ok' | 'wrong_pin' | 'no_user'>;
  logout: () => void;
  changePin: (userId: string, newPin: string) => Promise<void>;
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

  // Seed admin users on first app load (runs once)
  useEffect(() => {
    adminUsersService.seed(DEFAULT_ADMIN_PIN).catch(() => {/* ignore if offline */});
  }, []);

  const login = useCallback(async (username: string, pin: string): Promise<'ok' | 'wrong_pin' | 'no_user'> => {
    try {
      const user = await adminUsersService.verifyPin(username, pin);
      if (!user) {
        const exists = await adminUsersService.getByUsername(username);
        return exists ? 'wrong_pin' : 'no_user';
      }
      const session = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        mustChangePin: user.mustChangePin,
      };
      setCurrentUser(session);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return 'ok';
    } catch {
      return 'wrong_pin';
    }
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('skc_auth'); // clear legacy key too
  }, []);

  const changePin = useCallback(async (userId: string, newPin: string) => {
    await adminUsersService.changePin(userId, newPin);
    setCurrentUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, mustChangePin: false };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const changePinLegacy = useCallback(async (oldPin: string, newPin: string): Promise<boolean> => {
    if (!currentUser) return false;
    const valid = await adminUsersService.verifyPin(currentUser.username, oldPin);
    if (!valid) return false;
    await adminUsersService.changePin(currentUser.id, newPin);
    return true;
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
