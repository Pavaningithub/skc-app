import React, { createContext, useContext, useState, useCallback } from 'react';
import { settingsService } from '../lib/services';
import { DEFAULT_ADMIN_PIN } from '../lib/constants';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
    return sessionStorage.getItem('skc_auth') === 'true';
  });

  const login = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const correctPin = await settingsService.getPin();
      const valid = pin === correctPin || (correctPin === DEFAULT_ADMIN_PIN && pin === DEFAULT_ADMIN_PIN);
      if (valid) {
        setIsAdminAuthenticated(true);
        sessionStorage.setItem('skc_auth', 'true');
      }
      return valid;
    } catch {
      // Fallback to default PIN if Firebase not configured
      if (pin === DEFAULT_ADMIN_PIN) {
        setIsAdminAuthenticated(true);
        sessionStorage.setItem('skc_auth', 'true');
        return true;
      }
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setIsAdminAuthenticated(false);
    sessionStorage.removeItem('skc_auth');
  }, []);

  const changePin = useCallback(async (oldPin: string, newPin: string): Promise<boolean> => {
    const correctPin = await settingsService.getPin();
    if (oldPin !== correctPin) return false;
    await settingsService.setPin(newPin);
    return true;
  }, []);

  return (
    <AuthContext.Provider value={{ isAdminAuthenticated, login, logout, changePin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
