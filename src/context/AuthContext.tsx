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
    return {
      ...cloudUser,
      ...backendUser,
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
    prewarmGoogleAuth();
    const unsubFirebase = subscribeFirebaseAuth(async (cloudUser) => {
      if (!mounted) return;
      let backendUser: AuthUser | null = null;
      try {
        const res = await api.authMe();
        backendUser = res.authenticated ? res.user : null;
      } catch {
        backendUser = null;
      }

      if (
        cloudUser &&
        (!backendUser ||
          backendUser.email.toLowerCase() !== cloudUser.email.toLowerCase() ||
          (cloudUser.serialNumber && backendUser.serialNumber !== cloudUser.serialNumber))
      ) {
        try {
          const idToken = await getFirebaseIdToken();
          if (idToken) {
            const synced = await api.authCloudSync({
              idToken,
              name: cloudUser.name,
              grade: cloudUser.grade,
              serialNumber: cloudUser.serialNumber,
            });
            backendUser = synced.user;
          }
        } catch {
          // Non-fatal: keep cloudUser active even if backend sync fails transiently
        }
      }

      if (!mounted) return;
      setIsCloudUser(Boolean(cloudUser));
      setUser(mergeUsers(backendUser, cloudUser));
      setLoading(false);
    });

    const handleAuthUpdated = (ev: Event) => {
      const custom = ev as CustomEvent<AuthUser | null>;
      setUser((prev) => {
        if (!custom.detail) return null;
        return prev ? { ...prev, ...custom.detail, serialNumber: custom.detail.serialNumber ?? prev.serialNumber ?? null } : custom.detail;
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
    setUser((prev) => mergeUsers(prev && !isCloudUser ? prev : null, cloudUser));
    setIsCloudUser(true);
    return cloudUser;
  }, [isCloudUser]);

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
