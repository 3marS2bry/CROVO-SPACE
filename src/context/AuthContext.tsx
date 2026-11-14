import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, AuthUser } from '../utils/api';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isAuthModalOpen: boolean;
  authPromptReason: string | null;
  openAuthModal: (reason?: string, onAfterLogin?: (user: AuthUser) => void) => void;
  closeAuthModal: () => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  consumePendingAction: (loggedInUser: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [pendingCallback, setPendingCallback] = useState<((u: AuthUser) => void) | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.authMe();
      setUser(res.authenticated ? res.user : null);
    } catch {
      // Keep current user safely on transient network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const handleAuthUpdated = (ev: Event) => {
      const custom = ev as CustomEvent<AuthUser | null>;
      setUser(custom.detail ?? null);
    };
    window.addEventListener('crovo:auth-updated', handleAuthUpdated);
    return () => window.removeEventListener('crovo:auth-updated', handleAuthUpdated);
  }, [refreshUser]);

  const openAuthModal = useCallback(
    (reason?: string, onAfterLogin?: (loggedInUser: AuthUser) => void) => {
      setAuthPromptReason(reason || null);
      setPendingCallback(() => onAfterLogin || null);
      setIsAuthModalOpen(true);
    },
    []
  );

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setAuthPromptReason(null);
    setPendingCallback(null);
  }, []);

  const consumePendingAction = useCallback(
    (loggedInUser: AuthUser) => {
      setUser(loggedInUser);
      setIsAuthModalOpen(false);
      setAuthPromptReason(null);
      if (pendingCallback) {
        const cb = pendingCallback;
        setPendingCallback(null);
        window.setTimeout(() => cb(loggedInUser), 60);
      }
    },
    [pendingCallback]
  );

  const logout = useCallback(async () => {
    await api.authLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthModalOpen,
        authPromptReason,
        openAuthModal,
        closeAuthModal,
        refreshUser,
        logout,
        consumePendingAction,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
