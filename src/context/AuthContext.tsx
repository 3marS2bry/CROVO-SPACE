import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, AuthUser } from '../utils/api';
import { prewarmGoogleAuth } from '../firebase';
import {
  getFirebaseIdToken,
  getFirebaseUid,
  signInWithGoogleCloud,
  signOutCloud,
  subscribeFirebaseAuth,
} from '../utils/cloudStore';

interface AuthContextValue {
  user: AuthUser | null;
  isCloudUser: boolean;
  loading: boolean;
  isAuthModalOpen: boolean;
  authPromptReason: string | null;
  openAuthModal: (reason?: string, onAfterLogin?: (user: AuthUser) => void) => void;
  closeAuthModal: () => void;
  refreshUser: () => Promise<void>;
  loginWithGoogle: (preferredGrade?: 'bac1' | 'bac2') => Promise<AuthUser>;
  logout: () => Promise<void>;
  consumePendingAction: (loggedInUser: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mergeUsers(backendUser: AuthUser | null, cloudUser: AuthUser | null): AuthUser | null {
  if (backendUser && cloudUser) {
    const role: 'user' | 'admin' =
      backendUser.role === 'admin' || cloudUser.role === 'admin' ? 'admin' : 'user';
    return {
      ...cloudUser,
      ...backendUser,
      role,
      serialNumber: cloudUser.serialNumber ?? backendUser.serialNumber ?? null,
    };
  }
  return backendUser || cloudUser || null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isCloudUser, setIsCloudUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [pendingCallback, setPendingCallback] = useState<((u: AuthUser) => void) | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.authMe();
      if (res.authenticated && res.user) {
        setUser((prev) => mergeUsers(res.user, prev && isCloudUser ? prev : null));
        setIsCloudUser(Boolean(getFirebaseUid()));
      }
    } catch {
      // Keep current user safely on transient network error
    } finally {
      setLoading(false);
    }
  }, [isCloudUser]);

  useEffect(() => {
    let mounted = true;
    let lastSyncedUid: string | null = null;
    prewarmGoogleAuth();
    const unsubFirebase = subscribeFirebaseAuth(async (cloudUser) => {
      if (!mounted) return;
      if (!cloudUser) {
        lastSyncedUid = null;
        setIsCloudUser(false);
        setUser(null);
        setLoading(false);
        return;
      }

      // Immediately reflect authenticated cloud user so UI responds instantly
      setIsCloudUser(true);
      setUser((prev) => mergeUsers(prev && prev.id === cloudUser.id ? prev : null, cloudUser));
      setLoading(false);

      if (lastSyncedUid !== cloudUser.id || !cloudUser.serialNumber) {
        lastSyncedUid = cloudUser.id;
        try {
          const idToken = await getFirebaseIdToken();
          if (idToken && mounted) {
            const synced = await api.authCloudSync({
              idToken,
              name: cloudUser.name,
              grade: cloudUser.grade,
              serialNumber: cloudUser.serialNumber,
            });
            if (mounted && synced.user) {
              setUser((prev) => mergeUsers(synced.user, prev || cloudUser));
            }
          }
        } catch {
          // Non-fatal: keep cloudUser active even if backend sync fails transiently
        }
      }
    });

    const handleAuthUpdated = (ev: Event) => {
      const custom = ev as CustomEvent<AuthUser | null>;
      setUser((prev) => {
        if (!custom.detail) return null;
        if (!prev) return custom.detail;
        return {
          ...prev,
          ...custom.detail,
          role: prev.role === 'admin' || custom.detail.role === 'admin' ? 'admin' : 'user',
          serialNumber: custom.detail.serialNumber ?? prev.serialNumber ?? null,
        };
      });
      setIsCloudUser(Boolean(getFirebaseUid()));
    };
    window.addEventListener('crovo:auth-updated', handleAuthUpdated);
    return () => {
      mounted = false;
      unsubFirebase();
      window.removeEventListener('crovo:auth-updated', handleAuthUpdated);
    };
  }, []);

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
      setUser((prev) =>
        prev
          ? {
              ...prev,
              ...loggedInUser,
              role: prev.role === 'admin' || loggedInUser.role === 'admin' ? 'admin' : 'user',
              serialNumber: loggedInUser.serialNumber ?? prev.serialNumber ?? null,
            }
          : loggedInUser
      );
      setIsCloudUser(Boolean(getFirebaseUid()));
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

  const loginWithGoogle = useCallback(async (preferredGrade: 'bac1' | 'bac2' = 'bac1') => {
    const cloudUser = await signInWithGoogleCloud(preferredGrade);
    let finalUser = cloudUser;
    try {
      const idToken = await getFirebaseIdToken();
      if (idToken) {
        const synced = await api.authCloudSync({
          idToken,
          name: cloudUser.name,
          grade: preferredGrade,
          serialNumber: cloudUser.serialNumber,
        });
        finalUser = mergeUsers(synced.user, cloudUser) || cloudUser;
      }
    } catch {
      // Non-fatal: Firebase Auth succeeded; keep cloudUser
    }
    setUser(finalUser);
    setIsCloudUser(true);
    return finalUser;
  }, []);

  const logout = useCallback(async () => {
    await Promise.allSettled([signOutCloud(), api.authLogout()]);
    setIsCloudUser(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isCloudUser,
        loading,
        isAuthModalOpen,
        authPromptReason,
        openAuthModal,
        closeAuthModal,
        refreshUser,
        loginWithGoogle,
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
