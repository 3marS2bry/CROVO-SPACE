import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  FIREBASE_OAUTH_CLIENT_ID,
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  prewarmGoogleAuth,
} from '../firebase';
import type {
  AdminPollItem,
  AdminUserItem,
  AuthUser,
  CommentItem,
  OrderReceipt,
  PollState,
  PublicConfig,
  QuestionStatsResponse,
} from './api';

function isValidFirestoreId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

function generateCloudId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${hex}`;
}

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return new Date().toISOString();
}

export function isFirebaseUserSignedIn(): boolean {
  return Boolean(auth.currentUser);
}

export function getFirebaseUid(): string | null {
  return auth.currentUser?.uid || null;
}

function normalizeCloudUserId(uid: string): string {
  return uid.startsWith('fb_') ? uid.slice(3) : uid;
}

function resolveVerifiedUid(uid?: string | null): string | null {
  const activeUid = auth.currentUser?.uid || null;
  if (!activeUid || !uid || !isValidFirestoreId(activeUid)) return null;
  const raw = normalizeCloudUserId(uid);
  return raw === activeUid ? activeUid : null;
}

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch {
    return null;
  }
}

const inFlightProfileSyncs = new Map<string, Promise<AuthUser>>();
let pendingPreferredGrade: 'bac1' | 'bac2' | null = null;

const SERIAL_NUMBER_REGEX = /^CRV-[0-9]{4,}$/;

function isOfflineOrUnavailableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code || '';
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    code === 'unavailable' ||
    msg.includes('the client is offline') ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore backend') ||
    msg.includes('unavailable')
  );
}

function normalizeSerialNumber(val: unknown): string | null {
  return typeof val === 'string' && SERIAL_NUMBER_REGEX.test(val.trim()) ? val.trim() : null;
}

function mapUserProfileDoc(
  uid: string,
  data: Record<string, unknown>,
  fallbackName: string,
  fallbackEmail: string,
  isAdminBootstrap: boolean
): AuthUser {
  const profileRole = data.role === 'admin' || isAdminBootstrap ? 'admin' : 'user';
  const profileStatus = data.status === 'suspended' ? 'suspended' : 'active';
  const profileGrade = data.grade === 'bac2' ? 'bac2' : 'bac1';

  return {
    id: uid,
    serialNumber: normalizeSerialNumber(data.serialNumber),
    name: typeof data.name === 'string' && data.name ? data.name : fallbackName,
    email: typeof data.email === 'string' && data.email ? data.email : fallbackEmail,
    grade: profileGrade,
    role: profileRole,
    status: profileStatus,
    suspendReason: null,
  };
}

export async function syncCloudUserProfile(
  fbUser: User,
  preferredGrade?: 'bac1' | 'bac2',
  serialNumber?: string | null,
  preferredName?: string
): Promise<AuthUser> {
  const uid = fbUser.uid;
  const existingPromise = inFlightProfileSyncs.get(uid);
  if (existingPromise) {
    return existingPromise;
  }

  const effectiveGrade: 'bac1' | 'bac2' =
    preferredGrade || pendingPreferredGrade || 'bac1';
  const validSerial = normalizeSerialNumber(serialNumber);

  const syncTask = (async (): Promise<AuthUser> => {
    const userPath = `users/${uid}`;
    const userRef = doc(db, 'users', uid);

    let existingSnap;
    try {
      try {
        existingSnap = await getDocFromServer(userRef);
      } catch (serverErr) {
        if (isOfflineOrUnavailableError(serverErr)) {
          existingSnap = await getDoc(userRef);
        } else {
          throw serverErr;
        }
      }
    } catch (err) {
      if (isOfflineOrUnavailableError(err)) {
        return buildImmediateAuthUser(fbUser, effectiveGrade);
      }
      handleFirestoreError(err, OperationType.GET, userPath);
    }

    const normalizedEmail = (fbUser.email || '').trim().toLowerCase().slice(0, 160);
    const displayName = (preferredName || fbUser.displayName || normalizedEmail.split('@')[0] || 'طالب CROVO')
      .trim()
      .slice(0, 80);
    const safeName = displayName.length >= 2 ? displayName : `${displayName} طالب`;
    const safeEmail = normalizedEmail.length >= 3 ? normalizedEmail : `${uid}@users.crovo.local`.slice(0, 160);

    let isAdminBootstrap = false;
    try {
      const adminMarkerRef = doc(db, 'admins', uid);
      const adminMarkerSnap = await getDoc(adminMarkerRef);
      if (adminMarkerSnap.exists()) {
        isAdminBootstrap = true;
      } else if (fbUser.emailVerified) {
        // Probe list /admins: only succeeds if firestore.rules isAdmin() passes for this verified user
        await getDocs(query(collection(db, 'admins'), limit(1)));
        isAdminBootstrap = true;
        await setDoc(adminMarkerRef, {
          uid,
          email: safeEmail,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
    } catch {
      isAdminBootstrap = false;
    }

    if (!existingSnap.exists()) {
      const basePayload: Record<string, unknown> = {
        uid,
        name: safeName,
        email: safeEmail,
        grade: effectiveGrade === 'bac2' ? 'bac2' : 'bac1',
        role: 'user',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (fbUser.photoURL && fbUser.photoURL.length <= 500) {
        basePayload.photoUrl = fbUser.photoURL;
      }

      let assignedSerial: string | null = null;
      try {
        assignedSerial = await runTransaction(db, async (tx) => {
          const counterRef = doc(db, 'counters', 'user_serial');
          const freshUserSnap = await tx.get(userRef);
          if (freshUserSnap.exists()) {
            const existingSerial = normalizeSerialNumber(freshUserSnap.data().serialNumber);
            if (existingSerial) return existingSerial;
          }
          const counterSnap = await tx.get(counterRef);
          const nextCount = counterSnap.exists() ? Number(counterSnap.data().count || 1000) + 1 : 1001;
          const nextSerial = `CRV-${nextCount}`;
          if (counterSnap.exists()) {
            tx.update(counterRef, { count: nextCount, updatedAt: serverTimestamp() });
          } else {
            tx.set(counterRef, { id: 'user_serial', count: 1001, updatedAt: serverTimestamp() });
          }
          if (!freshUserSnap.exists()) {
            tx.set(userRef, { ...basePayload, serialNumber: nextSerial });
          } else {
            tx.update(userRef, { serialNumber: nextSerial, updatedAt: serverTimestamp() });
          }
          return nextSerial;
        });
      } catch {
        // Fallback single-doc create if transaction contended or counter blocked
        try {
          if (validSerial) basePayload.serialNumber = validSerial;
          await setDoc(userRef, basePayload);
          assignedSerial = validSerial;
        } catch (err) {
          try {
            const recheckSnap = await getDocFromServer(userRef);
            if (recheckSnap.exists()) {
              return mapUserProfileDoc(uid, recheckSnap.data(), safeName, safeEmail, isAdminBootstrap);
            }
          } catch {
            // Fall through to offline/structured error handling below
          }
          if (isOfflineOrUnavailableError(err)) {
            return buildImmediateAuthUser(fbUser, effectiveGrade);
          }
          handleFirestoreError(err, OperationType.CREATE, userPath);
        }
      }

      return {
        id: uid,
        serialNumber: assignedSerial,
        name: safeName,
        email: safeEmail,
        grade: effectiveGrade === 'bac2' ? 'bac2' : 'bac1',
        role: isAdminBootstrap ? 'admin' : 'user',
        status: 'active',
        suspendReason: null,
      };
    }

    const existingData = existingSnap.data();
    const mapped = mapUserProfileDoc(uid, existingData, safeName, normalizedEmail, isAdminBootstrap);
    if (!mapped.serialNumber) {
      try {
        const allocatedSerial = await runTransaction(db, async (tx) => {
          const counterRef = doc(db, 'counters', 'user_serial');
          const freshUserSnap = await tx.get(userRef);
          const currentSerial = freshUserSnap.exists()
            ? normalizeSerialNumber(freshUserSnap.data().serialNumber)
            : null;
          if (currentSerial) return currentSerial;

          const counterSnap = await tx.get(counterRef);
          const nextCount = counterSnap.exists() ? Number(counterSnap.data().count || 1000) + 1 : 1001;
          const nextSerial = `CRV-${nextCount}`;
          if (counterSnap.exists()) {
            tx.update(counterRef, { count: nextCount, updatedAt: serverTimestamp() });
          } else {
            tx.set(counterRef, { id: 'user_serial', count: 1001, updatedAt: serverTimestamp() });
          }
          tx.update(userRef, { serialNumber: nextSerial, updatedAt: serverTimestamp() });
          return nextSerial;
        });
        mapped.serialNumber = allocatedSerial;
      } catch {
        // Non-fatal fallback
      }
    }
    return mapped;
  })();

  inFlightProfileSyncs.set(uid, syncTask);
  try {
    return await syncTask;
  } finally {
    inFlightProfileSyncs.delete(uid);
  }
}

function mapFirebaseAuthError(err: unknown): Error {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
      return new Error('البريد الإلكتروني مستخدم بالفعل. جرّب تسجيل الدخول أو التحقق من كلمة المرور.');
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    case 'auth/weak-password':
      return new Error('كلمة المرور ضعيفة، يجب أن تكون 6 أحرف أو أرقام على الأقل.');
    case 'auth/invalid-email':
      return new Error('صيغة البريد الإلكتروني غير صحيحة.');
    case 'auth/too-many-requests':
      return new Error('تم حظر المحاولات مؤقتاً بسبب كثرة التجارب، حاول بعد دقائق.');
    case 'auth/network-request-failed':
      return new Error('تعذر الاتصال بخدمة المصادقة. تأكد من اتصالك بالإنترنت وحاول تاني.');
    default:
      return err instanceof Error ? err : new Error('تعذر إتمام عملية المصادقة عبر Firebase.');
  }
}

export async function registerWithEmailCloud(payload: {
  name: string;
  email: string;
  password: string;
  grade: 'bac1' | 'bac2';
  serialNumber?: string | null;
}): Promise<AuthUser> {
  try {
    let user: User;
    try {
      const cred = await createUserWithEmailAndPassword(auth, payload.email.trim(), payload.password);
      user = cred.user;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/email-already-in-use') {
        const cred = await signInWithEmailAndPassword(auth, payload.email.trim(), payload.password);
        user = cred.user;
      } else {
        throw err;
      }
    }
    if (payload.name.trim()) {
      await updateProfile(user, { displayName: payload.name.trim().slice(0, 80) }).catch(() => {});
    }
    return await syncCloudUserProfile(user, payload.grade, payload.serialNumber, payload.name);
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export async function signInWithEmailCloud(payload: {
  email: string;
  password: string;
  serialNumber?: string | null;
  name?: string;
  grade?: 'bac1' | 'bac2';
}): Promise<AuthUser> {
  try {
    const cred = await signInWithEmailAndPassword(auth, payload.email.trim(), payload.password);
    return await syncCloudUserProfile(cred.user, payload.grade, payload.serialNumber, payload.name);
  } catch (err) {
    throw mapFirebaseAuthError(err);
  }
}

export async function logCloudActivity(
  uid: string,
  payload: { eventType: string; label: string; path?: string; detail?: string }
): Promise<void> {
  const verifiedUid = resolveVerifiedUid(uid) || getFirebaseUid();
  if (!verifiedUid || !isValidFirestoreId(verifiedUid)) return;
  const id = generateCloudId('act');
  try {
    await setDoc(doc(db, 'users', verifiedUid, 'activities', id), {
      id,
      userId: verifiedUid,
      eventType: payload.eventType.trim().slice(0, 40) || 'activity',
      label: payload.label.trim().slice(0, 120) || 'نشاط',
      path: payload.path ? payload.path.trim().slice(0, 200) : '',
      detail: payload.detail ? payload.detail.trim().slice(0, 240) : '',
      createdAt: serverTimestamp(),
    });
  } catch {
    // Best-effort secondary mirror; never break UI action
  }
}

interface GoogleGsiAccounts {
  id: {
    initialize: (config: {
      client_id: string;
      callback: (response: { credential?: string }) => void;
      auto_select?: boolean;
      cancel_on_tap_outside?: boolean;
      context?: 'signin' | 'signup' | 'use';
      itp_support?: boolean;
      use_fedcm_for_prompt?: boolean;
    }) => void;
    prompt: (momentListener?: (notification: {
      isNotDisplayed?: () => boolean;
      isSkippedMoment?: () => boolean;
      isDismissedMoment?: () => boolean;
    }) => void) => void;
    cancel: () => void;
  };
}

function getWindowGoogleGsi(): GoogleGsiAccounts | null {
  if (typeof window === 'undefined') return null;
  const g = (window as unknown as { google?: { accounts?: GoogleGsiAccounts } }).google;
  return g?.accounts?.id ? g.accounts : null;
}

function buildImmediateAuthUser(fbUser: User, preferredGrade: 'bac1' | 'bac2' = 'bac1'): AuthUser {
  const normalizedEmail = (fbUser.email || '').trim().toLowerCase().slice(0, 160);
  const displayName = (fbUser.displayName || normalizedEmail.split('@')[0] || 'طالب CROVO')
    .trim()
    .slice(0, 80);
  const safeName = displayName.length >= 2 ? displayName : `${displayName} طالب`;
  return {
    id: fbUser.uid,
    serialNumber: null,
    name: safeName,
    email: normalizedEmail,
    grade: preferredGrade,
    role: 'user',
    status: 'active',
    suspendReason: null,
  };
}

function isFedCmAllowedInDocument(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  try {
    const docAny = document as unknown as {
      permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
      featurePolicy?: { allowsFeature?: (feature: string) => boolean };
    };
    const policy = docAny.permissionsPolicy || docAny.featurePolicy;
    if (policy && typeof policy.allowsFeature === 'function') {
      if (!policy.allowsFeature('identity-credentials-get')) {
        return false;
      }
    } else if (window.self !== window.top) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function launchInstantGoogleChooser(options: {
  preferredGrade?: 'bac1' | 'bac2';
  onSignedIn: (user: AuthUser) => void;
}): () => void {
  prewarmGoogleAuth();
  const preferredGrade = options.preferredGrade || 'bac1';
  if (!FIREBASE_OAUTH_CLIENT_ID || typeof window === 'undefined' || !isFedCmAllowedInDocument()) {
    return () => {};
  }

  let cancelled = false;
  let attempts = 0;

  const tryInit = () => {
    if (cancelled) return;
    const accounts = getWindowGoogleGsi();
    if (!accounts) {
      if (attempts < 15) {
        attempts += 1;
        window.setTimeout(tryInit, 120);
      }
      return;
    }

    try {
      accounts.id.initialize({
        client_id: FIREBASE_OAUTH_CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        context: 'signin',
        itp_support: true,
        use_fedcm_for_prompt: true,
        callback: async (response) => {
          if (cancelled || !response.credential) return;
          try {
            pendingPreferredGrade = preferredGrade;
            const cred = GoogleAuthProvider.credential(response.credential);
            const result = await signInWithCredential(auth, cred);
            void syncCloudUserProfile(result.user, preferredGrade).catch(() => {});
            options.onSignedIn(buildImmediateAuthUser(result.user, preferredGrade));
          } catch {
            // Silently leave normal & popup button ready if token exchange fails
          } finally {
            pendingPreferredGrade = null;
          }
        },
      });
      accounts.id.prompt();
    } catch {
      // Ignore GIS origin / browser restrictions cleanly
    }
  };

  tryInit();

  return () => {
    cancelled = true;
    try {
      getWindowGoogleGsi()?.id.cancel();
    } catch {
      // ignore
    }
  };
}

export async function signInWithGoogleCloud(preferredGrade: 'bac1' | 'bac2' = 'bac1'): Promise<AuthUser> {
  pendingPreferredGrade = preferredGrade;
  prewarmGoogleAuth();
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    if (!credential.user.emailVerified) {
      throw new Error('حساب Google غير موثق البريد الإلكتروني.');
    }
    // Sync Firestore user doc without blocking immediate login completion
    void syncCloudUserProfile(credential.user, preferredGrade).catch(() => {});
    return buildImmediateAuthUser(credential.user, preferredGrade);
  } finally {
    pendingPreferredGrade = null;
  }
}

export async function signOutCloud(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export function subscribeFirebaseAuth(
  onUser: (user: AuthUser | null, fbUser: User | null) => void
): () => void {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      onUser(null, null);
      return;
    }
    try {
      const profile = await syncCloudUserProfile(fbUser);
      onUser(profile, fbUser);
    } catch {
      onUser(
        {
          id: fbUser.uid,
          name: fbUser.displayName || 'طالب CROVO',
          email: fbUser.email || '',
          grade: 'bac1',
          role: 'user',
          status: 'active',
        },
        fbUser
      );
    }
  });
}

// ==================== TOOL LIKES (FIRESTORE) ====================

let sharedToolCount = 0;
let hasSharedToolCount = false;
const toolCountSubscribers = new Set<(count: number) => void>();
let sharedToolCounterUnsub: (() => void) | null = null;

function subscribeSharedToolCounter(cb: (count: number) => void): () => void {
  toolCountSubscribers.add(cb);
  if (hasSharedToolCount) {
    cb(sharedToolCount);
  }
  if (!sharedToolCounterUnsub) {
    sharedToolCounterUnsub = onSnapshot(
      doc(db, 'counters', 'tool'),
      (snap) => {
        if (snap.exists()) {
          const raw = Number(snap.data().count);
          sharedToolCount = Number.isFinite(raw) && raw >= 0 ? raw : 0;
        } else {
          sharedToolCount = 0;
        }
        hasSharedToolCount = true;
        for (const fn of toolCountSubscribers) {
          try {
            fn(sharedToolCount);
          } catch {
            // ignore subscriber error
          }
        }
      },
      (err) => {
        if (!isOfflineOrUnavailableError(err)) {
          handleFirestoreError(err, OperationType.GET, 'counters/tool');
        }
      }
    );
  }

  return () => {
    toolCountSubscribers.delete(cb);
    if (toolCountSubscribers.size === 0 && sharedToolCounterUnsub) {
      sharedToolCounterUnsub();
      sharedToolCounterUnsub = null;
    }
  };
}

export function subscribeToolLikesCloud(
  uid: string | null,
  onUpdate: (state: { count: number; liked: boolean }) => void
): () => void {
  let latestCount = hasSharedToolCount ? sharedToolCount : 0;
  let latestLiked = false;
  const emit = () => onUpdate({ count: latestCount, liked: latestLiked });

  const unsubCounter = subscribeSharedToolCounter((count) => {
    latestCount = count;
    emit();
  });

  const verifiedUid = resolveVerifiedUid(uid);
  let unsubLike: (() => void) | null = null;
  if (verifiedUid) {
    unsubLike = onSnapshot(
      doc(db, 'tool_likes', verifiedUid),
      (snap) => {
        latestLiked = snap.exists();
        emit();
      },
      (err) => {
        if (!isOfflineOrUnavailableError(err)) {
          handleFirestoreError(err, OperationType.GET, `tool_likes/${verifiedUid}`);
        }
      }
    );
  }

  return () => {
    unsubCounter();
    if (unsubLike) unsubLike();
  };
}

const inFlightLikeOps = new Map<string, Promise<{ count: number; liked: boolean }>>();

async function getFreshSnap(ref: ReturnType<typeof doc>) {
  try {
    return await getDocFromServer(ref);
  } catch (err) {
    if (isOfflineOrUnavailableError(err)) {
      return getDoc(ref);
    }
    throw err;
  }
}

export async function toggleToolLikeCloud(
  uid: string,
  desiredLiked?: boolean
): Promise<{ count: number; liked: boolean }> {
  const verifiedUid = resolveVerifiedUid(uid) || getFirebaseUid();
  if (!verifiedUid || !isValidFirestoreId(verifiedUid)) {
    throw new Error('معرف المستخدم غير صالح.');
  }
  const opKey = `tool:${verifiedUid}`;
  const inFlight = inFlightLikeOps.get(opKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<{ count: number; liked: boolean }> => {
    const counterRef = doc(db, 'counters', 'tool');
    const likeRef = doc(db, 'tool_likes', verifiedUid);

    let counterSnap;
    let likeSnap;
    try {
      [counterSnap, likeSnap] = await Promise.all([getFreshSnap(counterRef), getFreshSnap(likeRef)]);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'counters/tool');
    }

    const currentCount = counterSnap.exists() ? Math.max(0, Number(counterSnap.data().count || 0)) : 0;
    const currentlyLiked = likeSnap.exists();
    const shouldLike = typeof desiredLiked === 'boolean' ? desiredLiked : !currentlyLiked;

    if (shouldLike === currentlyLiked) {
      return { count: currentCount, liked: currentlyLiked };
    }

    const batch = writeBatch(db);
    let nextCount = currentCount;

    if (shouldLike) {
      nextCount = currentCount + 1;
      batch.set(likeRef, {
        userId: verifiedUid,
        createdAt: serverTimestamp(),
      });
      if (counterSnap.exists()) {
        batch.update(counterRef, {
          count: nextCount,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(counterRef, {
          id: 'tool',
          count: 1,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      nextCount = Math.max(0, currentCount - 1);
      batch.delete(likeRef);
      if (counterSnap.exists()) {
        batch.update(counterRef, {
          count: nextCount,
          updatedAt: serverTimestamp(),
        });
      }
    }

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'counters/tool');
    }

    return { count: nextCount, liked: shouldLike };
  })();

  inFlightLikeOps.set(opKey, task);
  try {
    return await task;
  } finally {
    inFlightLikeOps.delete(opKey);
  }
}

// ==================== COMMENTS & REVIEWS (FIRESTORE) ====================

export function subscribeCloudComments(
  currentUid: string | null,
  onUpdate: (comments: CommentItem[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'comments'),
    where('status', '==', 'approved'),
    limit(200)
  );

  const verifiedUid = resolveVerifiedUid(currentUid);

  return onSnapshot(
    q,
    async (snapshot) => {
      try {
        const docs = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));

        const likedSet = new Set<string>();
        if (verifiedUid && docs.length > 0) {
          const checks = await Promise.all(
            docs.map(async (item) => {
              try {
                const snap = await getDoc(doc(db, 'comments', item.id, 'likes', verifiedUid));
                return snap.exists() ? item.id : null;
              } catch {
                return null;
              }
            })
          );
          for (const likedId of checks) {
            if (likedId) likedSet.add(likedId);
          }
        }

        const mapped: CommentItem[] = docs
          .map(({ id, data }) => {
            const beforeUrl =
              typeof data.attachmentBeforeDataUrl === 'string' && data.attachmentBeforeDataUrl
                ? data.attachmentBeforeDataUrl
                : null;
            const afterUrl =
              typeof data.attachmentAfterDataUrl === 'string' && data.attachmentAfterDataUrl
                ? data.attachmentAfterDataUrl
                : null;
            return {
              id,
              authorName: String(data.authorName || ''),
              grade: String(data.grade || 'تانية بكالوريا'),
              rating: Number(data.rating || 5),
              content: String(data.content || ''),
              avatarUrl: typeof data.avatarDataUrl === 'string' ? data.avatarDataUrl : null,
              attachmentUrl: beforeUrl,
              attachmentBeforeUrl: beforeUrl,
              attachmentAfterUrl: afterUrl,
              contactPhone: null,
              showContactPublicly: false,
              isVerified: Boolean(data.isVerified),
              isOwner: Boolean(verifiedUid && data.authorUid === verifiedUid),
              likesCount: Math.max(0, Number(data.likesCount || 0)),
              hasLiked: likedSet.has(id),
              createdAt: toIsoString(data.createdAt),
              updatedAt: data.updatedAt ? toIsoString(data.updatedAt) : null,
              source: 'cloud' as const,
            };
          })
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        onUpdate(mapped);
      } catch (err) {
        if (onError) onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (err) => {
      if (isOfflineOrUnavailableError(err)) {
        if (onError) onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      try {
        handleFirestoreError(err, OperationType.LIST, 'comments');
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export async function createCloudComment(
  uid: string,
  payload: {
    id?: string;
    authorName: string;
    grade: string;
    rating: number;
    content: string;
    contactPhone?: string;
    avatarDataUrl?: string | null;
    attachmentBeforeDataUrl?: string | null;
    attachmentAfterDataUrl?: string | null;
  }
): Promise<CommentItem> {
  const verifiedUid = resolveVerifiedUid(uid) || getFirebaseUid();
  if (!verifiedUid || !isValidFirestoreId(verifiedUid)) {
    throw new Error('سجّل دخولك الأول عشان تقدر تنشر تعليقك.');
  }

  const authorName = payload.authorName.trim().slice(0, 60);
  const grade = payload.grade.trim().slice(0, 60) || 'تانية بكالوريا';
  const content = payload.content.trim().slice(0, 600);
  const rating = Math.min(5, Math.max(1, Math.round(Number(payload.rating) || 5)));

  if (authorName.length < 2) {
    throw new Error('من فضلك اكتب اسمك (حرفين على الأقل).');
  }
  if (content.length < 4) {
    throw new Error('التعليق لازم يكون 4 أحرف على الأقل.');
  }
  if (/https?:\/\/|www\./i.test(`${authorName} ${content}`)) {
    throw new Error('ممنوع إضافة روابط خارجية داخل التعليقات لمنع السبام.');
  }

  const id = payload.id && isValidFirestoreId(payload.id) ? payload.id : generateCloudId('cmt');
  const commentRef = doc(db, 'comments', id);
  const docBody: Record<string, unknown> = {
    id,
    authorUid: verifiedUid,
    authorName,
    grade,
    rating,
    content,
    isVerified: false,
    status: 'approved',
    likesCount: 0,
    reportsCount: 0,
    createdAt: serverTimestamp(),
  };

  if (payload.avatarDataUrl && payload.avatarDataUrl.length <= 120000) {
    docBody.avatarDataUrl = payload.avatarDataUrl;
  }
  if (payload.attachmentBeforeDataUrl && payload.attachmentBeforeDataUrl.length <= 320000) {
    docBody.attachmentBeforeDataUrl = payload.attachmentBeforeDataUrl;
  }
  if (payload.attachmentAfterDataUrl && payload.attachmentAfterDataUrl.length <= 320000) {
    docBody.attachmentAfterDataUrl = payload.attachmentAfterDataUrl;
  }

  const batch = writeBatch(db);
  batch.set(commentRef, docBody);

  const cleanedPhone = payload.contactPhone ? payload.contactPhone.trim().replace(/[\s-]/g, '') : '';
  if (cleanedPhone) {
    if (!/^\+?\d{8,15}$/.test(cleanedPhone)) {
      throw new Error('رقم الهاتف غير صحيح. اكتب رقم موبايل صحيح أو اتركه فاضي.');
    }
    batch.set(doc(db, 'comments', id, 'private', 'contact'), {
      commentId: id,
      authorUid: verifiedUid,
      contactPhone: cleanedPhone,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `comments/${id}`);
  }

  const nowIso = new Date().toISOString();
  return {
    id,
    authorName,
    grade,
    rating,
    content,
    avatarUrl: (docBody.avatarDataUrl as string) || null,
    attachmentUrl: (docBody.attachmentBeforeDataUrl as string) || null,
    attachmentBeforeUrl: (docBody.attachmentBeforeDataUrl as string) || null,
    attachmentAfterUrl: (docBody.attachmentAfterDataUrl as string) || null,
    contactPhone: null,
    showContactPublicly: false,
    isVerified: false,
    isOwner: true,
    likesCount: 0,
    hasLiked: false,
    createdAt: nowIso,
    updatedAt: null,
    source: 'cloud',
  };
}

export async function updateCloudComment(
  commentId: string,
  payload: { authorName?: string; grade?: string; rating?: number; content: string }
): Promise<void> {
  if (!isValidFirestoreId(commentId)) throw new Error('معرّف التعليق غير صالح.');
  const commentRef = doc(db, 'comments', commentId);
  const content = payload.content.trim().slice(0, 600);
  if (content.length < 4) throw new Error('التعليق لازم يكون 4 أحرف على الأقل.');
  if (/https?:\/\/|www\./i.test(content)) {
    throw new Error('ممنوع إضافة روابط خارجية داخل التعليقات لمنع السبام.');
  }

  const updateFields: Record<string, unknown> = {
    content,
    updatedAt: serverTimestamp(),
  };
  if (typeof payload.rating === 'number') {
    updateFields.rating = Math.min(5, Math.max(1, Math.round(payload.rating)));
  }
  if (typeof payload.authorName === 'string' && payload.authorName.trim().length >= 2) {
    updateFields.authorName = payload.authorName.trim().slice(0, 60);
  }
  if (typeof payload.grade === 'string' && payload.grade.trim().length >= 2) {
    updateFields.grade = payload.grade.trim().slice(0, 60);
  }

  try {
    await updateDoc(commentRef, updateFields);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `comments/${commentId}`);
  }
}

export async function deleteCloudComment(commentId: string): Promise<void> {
  if (!isValidFirestoreId(commentId)) throw new Error('معرّف التعليق غير صالح.');
  try {
    await deleteDoc(doc(db, 'comments', commentId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `comments/${commentId}`);
  }
}

export async function toggleCloudCommentLike(
  commentId: string,
  uid: string,
  desiredLiked?: boolean
): Promise<{ count: number; liked: boolean }> {
  const verifiedUid = resolveVerifiedUid(uid) || getFirebaseUid();
  if (!isValidFirestoreId(commentId) || !verifiedUid || !isValidFirestoreId(verifiedUid)) {
    throw new Error('معرف غير صالح.');
  }

  const opKey = `comment:${commentId}:${verifiedUid}`;
  const inFlight = inFlightLikeOps.get(opKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<{ count: number; liked: boolean }> => {
    const commentRef = doc(db, 'comments', commentId);
    const likeRef = doc(db, 'comments', commentId, 'likes', verifiedUid);

    let commentSnap;
    let likeSnap;
    try {
      [commentSnap, likeSnap] = await Promise.all([getFreshSnap(commentRef), getFreshSnap(likeRef)]);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `comments/${commentId}`);
    }

    if (!commentSnap.exists()) {
      throw new Error('التعليق غير موجود.');
    }

    const currentCount = Math.max(0, Number(commentSnap.data().likesCount || 0));
    const currentlyLiked = likeSnap.exists();
    const shouldLike = typeof desiredLiked === 'boolean' ? desiredLiked : !currentlyLiked;

    if (shouldLike === currentlyLiked) {
      return { count: currentCount, liked: currentlyLiked };
    }

    const batch = writeBatch(db);
    const nextCount = shouldLike ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (shouldLike) {
      batch.set(likeRef, {
        commentId,
        userId: verifiedUid,
        createdAt: serverTimestamp(),
      });
    } else {
      batch.delete(likeRef);
    }

    batch.update(commentRef, { likesCount: nextCount });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `comments/${commentId}/likes/${verifiedUid}`);
    }

    return { count: nextCount, liked: shouldLike };
  })();

  inFlightLikeOps.set(opKey, task);
  try {
    return await task;
  } finally {
    inFlightLikeOps.delete(opKey);
  }
}

export async function reportCloudComment(
  commentId: string,
  uid: string,
  reason: string
): Promise<{ flaggedForReview: boolean; message: string }> {
  const verifiedUid = resolveVerifiedUid(uid) || getFirebaseUid();
  if (!isValidFirestoreId(commentId) || !verifiedUid || !isValidFirestoreId(verifiedUid)) {
    throw new Error('معرف غير صالح.');
  }

  const commentRef = doc(db, 'comments', commentId);
  const reportRef = doc(db, 'comments', commentId, 'reports', verifiedUid);

  let commentSnap;
  let existingReport;
  try {
    [commentSnap, existingReport] = await Promise.all([getDoc(commentRef), getDoc(reportRef)]);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `comments/${commentId}/reports/${verifiedUid}`);
  }

  if (!commentSnap.exists()) {
    throw new Error('التعليق غير موجود.');
  }
  if (existingReport.exists()) {
    throw new Error('أنت بلغت عن التعليق ده قبل كده بالفعل.');
  }

  const nextReports = Math.max(0, Number(commentSnap.data().reportsCount || 0)) + 1;
  const flaggedForReview = nextReports >= 3;

  const batch = writeBatch(db);
  batch.set(reportRef, {
    commentId,
    userId: verifiedUid,
    reason: reason.trim().slice(0, 120) || 'محتوى غير مناسب',
    createdAt: serverTimestamp(),
  });
  batch.update(commentRef, {
    reportsCount: nextReports,
    status: flaggedForReview ? 'flagged' : 'approved',
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `comments/${commentId}/reports/${verifiedUid}`);
  }

  return {
    flaggedForReview,
    message: 'تم استلام بلاغك وهيتم مراجعته من الإدارة.',
  };
}

// ==================== SITE CONFIG (CROSS-DEPLOYMENT SYNC) ====================

function stripUndefinedDeep<T>(val: T): T {
  if (Array.isArray(val)) {
    return val.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return val;
}

export function subscribeSiteConfigCloud(
  onUpdate: (partialConfig: Partial<PublicConfig>) => void
): () => void {
  return onSnapshot(
    doc(db, 'site_config', 'public'),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const partial: Partial<PublicConfig> = {
        qureoOldPrice: Number(d.qureoOldPrice || 100),
        qureoOfferPrice: Number(d.qureoOfferPrice || 50),
        bundleOldPrice: Number(d.bundleOldPrice || 200),
        bundleOfferPrice: Number(d.bundleOfferPrice || 100),
        offerEndsAt: typeof d.offerEndsAt === 'string' ? d.offerEndsAt : new Date(Date.now() + 48 * 3600_000).toISOString(),
        adminWhatsappDisplay: typeof d.whatsappNumber === 'string' ? d.whatsappNumber : '201000000000',
        notificationsEnabled: typeof d.notificationsEnabled === 'boolean' ? d.notificationsEnabled : true,
        notificationsIntervalDays: Number(d.notificationsIntervalDays || 3),
      };
      if (d.promoBanner && typeof d.promoBanner === 'object') {
        partial.promoBanner = d.promoBanner as PublicConfig['promoBanner'];
      }
      if (d.libraryAd && typeof d.libraryAd === 'object') {
        partial.libraryAd = d.libraryAd as PublicConfig['libraryAd'];
      }
      if (Array.isArray(d.toolServices)) {
        partial.toolServices = d.toolServices as PublicConfig['toolServices'];
      }
      if (Array.isArray(d.toolVideos)) {
        partial.toolVideos = d.toolVideos as PublicConfig['toolVideos'];
      }
      onUpdate(partial);
    },
    () => {
      // Ignore read errors silently
    }
  );
}

export async function syncSiteConfigToCloud(
  config: Partial<PublicConfig> & {
    whatsappNumber?: string;
    offerText?: string;
    offerDurationHours?: number;
  }
): Promise<void> {
  if (!auth.currentUser) return;
  try {
    const rawWhatsapp = String(config.whatsappNumber || config.adminWhatsappDisplay || '201000000000')
      .replace(/\D/g, '')
      .slice(0, 24);
    const safeWhatsapp = rawWhatsapp.length >= 6 ? rawWhatsapp : '201000000000';

    const cleanLibAd = config.libraryAd ? stripUndefinedDeep({ ...config.libraryAd }) : undefined;
    if (cleanLibAd && typeof cleanLibAd.imageUrl === 'string' && cleanLibAd.imageUrl.length > 350_000) {
      delete cleanLibAd.imageUrl;
    }

    const payload: Record<string, unknown> = {
      id: 'public',
      qureoOldPrice: Math.max(1, Math.round(Number(config.qureoOldPrice || 100))),
      qureoOfferPrice: Math.max(1, Math.round(Number(config.qureoOfferPrice || 50))),
      bundleOldPrice: Math.max(1, Math.round(Number(config.bundleOldPrice || 200))),
      bundleOfferPrice: Math.max(1, Math.round(Number(config.bundleOfferPrice || 100))),
      offerDurationHours: Math.max(1, Number(config.offerDurationHours || 48)),
      offerEndsAt: typeof config.offerEndsAt === 'string' ? config.offerEndsAt.slice(0, 64) : new Date(Date.now() + 48 * 3600_000).toISOString(),
      whatsappNumber: safeWhatsapp,
      notificationsEnabled: config.notificationsEnabled !== false,
      notificationsIntervalDays: Math.max(1, Math.min(365, Math.round(Number(config.notificationsIntervalDays || 3)))),
      updatedAt: serverTimestamp(),
    };
    if (typeof config.offerText === 'string' && config.offerText.trim()) {
      payload.offerText = config.offerText.trim().slice(0, 400);
    }
    if (config.promoBanner) {
      payload.promoBanner = stripUndefinedDeep(config.promoBanner);
    }
    if (cleanLibAd) {
      payload.libraryAd = cleanLibAd;
    }
    if (Array.isArray(config.toolServices)) {
      payload.toolServices = stripUndefinedDeep(config.toolServices.slice(0, 30));
    }
    if (Array.isArray(config.toolVideos)) {
      payload.toolVideos = stripUndefinedDeep(config.toolVideos.slice(0, 30));
    }

    await setDoc(doc(db, 'site_config', 'public'), payload, { merge: false });
  } catch {
    // Non-fatal if user is not admin in Firebase
  }
}

// ==================== POLLS (CROSS-DEPLOYMENT SYNC) ====================

function mapPollDocToState(
  id: string,
  d: Record<string, unknown>,
  userChoice: string | null
): PollState {
  const rawOptions = Array.isArray(d.options) ? (d.options as Array<Record<string, unknown>>) : [];
  const totalVotes = rawOptions.reduce((sum, o) => sum + Math.max(0, Number(o.count || 0)), 0);
  const options = rawOptions.map((o) => {
    const count = Math.max(0, Number(o.count || 0));
    return {
      key: String(o.key || ''),
      label: String(o.label || ''),
      count,
      percent: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0,
    };
  });
  const endsAt = typeof d.endsAt === 'string' ? d.endsAt : null;
  const expired = Boolean(endsAt && Date.parse(endsAt) <= Date.now());
  const closed = d.isOpen === false || expired;
  const ext = options.find((o) => o.key === 'extend') || options[0];
  const eno = options.find((o) => o.key === 'enough') || options[1];

  return {
    pollId: id,
    question: String(d.question || 'إيه رأيكم نمد العرض؟'),
    closed,
    startsAt: typeof d.startsAt === 'string' ? d.startsAt : null,
    endsAt,
    requiresAuth: true,
    totalVotes,
    extendCount: ext?.count || 0,
    enoughCount: eno?.count || 0,
    extendPercent: ext?.percent || 0,
    enoughPercent: eno?.percent || 0,
    userChoice,
    options,
  };
}

export function subscribeActivePollCloud(
  uid: string | null,
  onUpdate: (poll: PollState) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'polls'), limit(20)),
    async (snap) => {
      if (snap.empty) return;
      const docs = snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .sort((a, b) => Date.parse(toIsoString(b.data.createdAt)) - Date.parse(toIsoString(a.data.createdAt)));
      const latest = docs[0];
      let userChoice: string | null = null;
      const verifiedUid = resolveVerifiedUid(uid);
      if (verifiedUid) {
        try {
          const voteSnap = await getDoc(doc(db, 'polls', latest.id, 'votes', verifiedUid));
          if (voteSnap.exists()) {
            userChoice = String(voteSnap.data().choice || '');
          }
        } catch {
          // ignore
        }
      }
      onUpdate(mapPollDocToState(latest.id, latest.data, userChoice));
    },
    () => {
      // ignore read errors
    }
  );
}

export async function votePollCloud(
  pollId: string,
  uid: string,
  choice: string
): Promise<PollState | null> {
  const verifiedUid = resolveVerifiedUid(uid) || getFirebaseUid();
  if (!isValidFirestoreId(pollId) || !verifiedUid || !isValidFirestoreId(verifiedUid)) return null;
  const pollRef = doc(db, 'polls', pollId);
  const voteRef = doc(db, 'polls', pollId, 'votes', verifiedUid);

  try {
    const resultState = await runTransaction(db, async (tx) => {
      const [pollSnap, voteSnap] = await Promise.all([tx.get(pollRef), tx.get(voteRef)]);
      if (!pollSnap.exists()) return null;
      if (voteSnap.exists()) {
        throw new Error('لقد قمت بالتصويت مسبقًا في هذا الاستطلاع.');
      }
      const data = pollSnap.data();
      if (data.isOpen === false) {
        throw new Error('التصويت مغلق حالياً من الإدارة.');
      }
      const rawOptions = Array.isArray(data.options) ? (data.options as Array<Record<string, unknown>>) : [];
      const updatedOptions = rawOptions.map((o) =>
        o.key === choice ? { ...o, count: Number(o.count || 0) + 1 } : o
      );
      const nextTotal = Number(data.totalVotes || 0) + 1;

      tx.set(voteRef, {
        pollId,
        userId: verifiedUid,
        choice,
        createdAt: serverTimestamp(),
      });
      tx.update(pollRef, {
        options: updatedOptions,
        totalVotes: nextTotal,
        updatedAt: serverTimestamp(),
      });

      return mapPollDocToState(
        pollId,
        { ...data, options: updatedOptions, totalVotes: nextTotal },
        choice
      );
    });
    return resultState;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('مسبقًا') || err.message.includes('مغلق'))) {
      throw err;
    }
    return null;
  }
}

export async function listAllPollsAdminCloud(): Promise<AdminPollItem[]> {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(query(collection(db, 'polls'), limit(50)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        const rawOptions = Array.isArray(data.options) ? (data.options as Array<Record<string, unknown>>) : [];
        const totalVotes = rawOptions.reduce((sum, o) => sum + Math.max(0, Number(o.count || 0)), 0);
        return {
          id: d.id,
          slug: d.id,
          question: String(data.question || ''),
          isOpen: data.isOpen !== false,
          startsAt: typeof data.startsAt === 'string' ? data.startsAt : null,
          endsAt: typeof data.endsAt === 'string' ? data.endsAt : null,
          createdAt: toIsoString(data.createdAt),
          updatedAt: data.updatedAt ? toIsoString(data.updatedAt) : null,
          totalVotes,
          options: rawOptions.map((o, idx) => {
            const votes = Math.max(0, Number(o.count || 0));
            return {
              key: String(o.key || `opt_${idx + 1}`),
              label: String(o.label || ''),
              sortOrder: idx,
              votes,
              percent: totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0,
            };
          }),
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function savePollToCloud(poll: {
  id: string;
  question: string;
  isOpen: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  options: Array<{ key: string; label: string; count?: number; votes?: number }>;
}): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(poll.id)) return;
  try {
    const pollRef = doc(db, 'polls', poll.id);
    const snap = await getDoc(pollRef);
    const normalizedOptions = poll.options.slice(0, 12).map((o) => ({
      key: o.key,
      label: o.label.trim().slice(0, 100),
      count: Math.max(0, Math.round(Number(o.count ?? o.votes ?? 0))),
    }));
    const totalVotes = normalizedOptions.reduce((sum, o) => sum + o.count, 0);

    const payload: Record<string, unknown> = {
      id: poll.id,
      question: poll.question.trim().slice(0, 240),
      options: normalizedOptions,
      totalVotes,
      isOpen: Boolean(poll.isOpen),
      createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (poll.startsAt && poll.startsAt.trim()) payload.startsAt = poll.startsAt.trim().slice(0, 64);
    if (poll.endsAt && poll.endsAt.trim()) payload.endsAt = poll.endsAt.trim().slice(0, 64);

    await setDoc(pollRef, payload);
  } catch {
    // Non-fatal if user is not admin in Firestore
  }
}

export async function resetPollInCloud(pollId: string): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(pollId)) return;
  try {
    const pollRef = doc(db, 'polls', pollId);
    const snap = await getDoc(pollRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const rawOptions = Array.isArray(data.options) ? (data.options as Array<Record<string, unknown>>) : [];
    const resetOptions = rawOptions.map((o) => ({ key: String(o.key || ''), label: String(o.label || ''), count: 0 }));

    const votesSnap = await getDocs(collection(db, 'polls', pollId, 'votes'));
    const batch = writeBatch(db);
    votesSnap.docs.slice(0, 450).forEach((v) => batch.delete(v.ref));
    batch.update(pollRef, {
      options: resetOptions,
      totalVotes: 0,
      isOpen: true,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    // ignore
  }
}

// ==================== ORDERS (CROSS-DEPLOYMENT PERSISTENCE — NO PLAINTEXT PASSWORDS) ====================

export interface CloudOrderItem {
  id: string;
  orderCode: string;
  userId: string | null;
  userSerialNumber: string | null;
  userEmail: string | null;
  fullName: string;
  grade: 'bac1' | 'bac2';
  platformLabel: string;
  sectionDetails: string;
  platformUsername: string;
  platformPassword: string | null;
  credentialsPurged: boolean;
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  paymentMethod: string;
  status: 'new' | 'reviewing' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string | null;
}

export async function saveOrderMetadataCloud(payload: {
  order: OrderReceipt;
  authorUid: string;
  userSerialNumber?: string | null;
  userEmail?: string | null;
  platformUsername: string;
  credentialsPurged?: boolean;
}): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(payload.order.id) || !isValidFirestoreId(payload.authorUid)) {
    return;
  }
  try {
    const ref = doc(db, 'orders', payload.order.id);
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) return;

    const docData: Record<string, unknown> = {
      id: payload.order.id,
      orderCode: String(payload.order.orderCode).slice(0, 40),
      authorUid: payload.authorUid,
      fullName: String(payload.order.fullName || 'طالب').trim().slice(0, 120),
      grade: payload.order.grade === 'bac2' ? 'bac2' : 'bac1',
      platformLabel: String(payload.order.platformLabel || '').slice(0, 160),
      sectionDetails: String(payload.order.sectionDetails || '').slice(0, 240),
      platformUsername: String(payload.platformUsername || '-').slice(0, 160),
      credentialsPurged: Boolean(payload.credentialsPurged),
      oldPrice: Math.max(0, Math.round(Number(payload.order.oldPrice || 0))),
      finalPrice: Math.max(0, Math.round(Number(payload.order.finalPrice || 0))),
      offerApplied: Boolean(payload.order.offerApplied),
      paymentMethod: String(payload.order.paymentMethod || 'Vodafone Cash').slice(0, 80),
      status: payload.order.status || 'new',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (payload.userSerialNumber) docData.userSerialNumber = payload.userSerialNumber.slice(0, 32);
    if (payload.userEmail) docData.userEmail = payload.userEmail.slice(0, 160);

    await setDoc(ref, docData);
  } catch {
    // Non-fatal cloud backup
  }
}

export async function listOrdersAdminCloud(): Promise<CloudOrderItem[]> {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(query(collection(db, 'orders'), limit(300)));
    return snap.docs
      .map((d) => {
        const o = d.data();
        return {
          id: d.id,
          orderCode: String(o.orderCode || ''),
          userId: o.authorUid && o.authorUid !== 'guest_order' ? String(o.authorUid) : null,
          userSerialNumber: typeof o.userSerialNumber === 'string' ? o.userSerialNumber : null,
          userEmail: typeof o.userEmail === 'string' ? o.userEmail : null,
          fullName: String(o.fullName || ''),
          grade: (o.grade === 'bac2' ? 'bac2' : 'bac1') as 'bac1' | 'bac2',
          platformLabel: String(o.platformLabel || ''),
          sectionDetails: String(o.sectionDetails || ''),
          platformUsername: String(o.platformUsername || ''),
          platformPassword: null,
          credentialsPurged: Boolean(o.credentialsPurged),
          oldPrice: Number(o.oldPrice || 0),
          finalPrice: Number(o.finalPrice || 0),
          offerApplied: Boolean(o.offerApplied),
          paymentMethod: String(o.paymentMethod || ''),
          status: (o.status as CloudOrderItem['status']) || 'new',
          createdAt: toIsoString(o.createdAt),
          updatedAt: o.updatedAt ? toIsoString(o.updatedAt) : null,
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function updateOrderAdminCloud(
  id: string,
  payload: { status?: CloudOrderItem['status']; credentialsPurged?: boolean }
): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(id)) return;
  try {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (payload.status) updates.status = payload.status;
    if (typeof payload.credentialsPurged === 'boolean') {
      updates.credentialsPurged = payload.credentialsPurged;
    }
    await updateDoc(doc(db, 'orders', id), updates);
  } catch {
    // Non-fatal
  }
}

export async function deleteOrderAdminCloud(id: string): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(id)) return;
  try {
    await deleteDoc(doc(db, 'orders', id));
  } catch {
    // Non-fatal
  }
}

// ==================== QUESTION STATS, REPORTS & LIBRARY OVERRIDES ====================

export async function fetchQuestionStatsCloud(): Promise<QuestionStatsResponse | null> {
  try {
    const snap = await getDocs(query(collection(db, 'question_stats'), limit(500)));
    if (snap.empty) return null;
    const copyCounts: Record<string, number> = {};
    const items: QuestionStatsResponse['topQuestions'] = [];
    let totalCopies = 0;

    for (const d of snap.docs) {
      const s = d.data();
      const count = Math.max(0, Number(s.copyCount || 0));
      if (count > 0) {
        copyCounts[d.id] = count;
        totalCopies += count;
        items.push({
          questionKey: d.id,
          grade: s.grade === 'bac2' ? 'bac2' : 'bac1',
          section: s.section === 'py' || s.section === 'fin' ? s.section : 'js',
          chapterNum: Number(s.chapterNum || 1),
          qIndex: Number(s.qIndex || 0),
          questionTitle: String(s.questionTitle || ''),
          copyCount: count,
        });
      }
    }

    items.sort((a, b) => b.copyCount - a.copyCount);
    return { totalCopies, copyCounts, topQuestions: items.slice(0, 6) };
  } catch {
    return null;
  }
}

export async function incrementQuestionCopyCloud(payload: {
  questionKey: string;
  grade: 'bac1' | 'bac2';
  section: 'js' | 'py' | 'fin';
  chapterNum: number;
  qIndex: number;
  questionTitle: string;
  minCount?: number;
}): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(payload.questionKey)) return;
  try {
    const ref = doc(db, 'question_stats', payload.questionKey);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const nextTitle = payload.questionTitle.trim().slice(0, 300) || `السؤال ${payload.qIndex + 1}`;
      if (!snap.exists()) {
        tx.set(ref, {
          questionKey: payload.questionKey,
          grade: payload.grade,
          section: payload.section,
          chapterNum: Math.max(1, Math.round(payload.chapterNum)),
          qIndex: Math.max(0, Math.round(payload.qIndex)),
          questionTitle: nextTitle,
          copyCount: 1,
          updatedAt: serverTimestamp(),
        });
      } else {
        const cur = Number(snap.data().copyCount || 0);
        tx.update(ref, {
          copyCount: cur + 1,
          questionTitle: nextTitle,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch {
    // Non-fatal background sync
  }
}

export async function saveQuestionReportCloud(payload: {
  id: string;
  reporterUid: string;
  questionKey: string;
  grade: 'bac1' | 'bac2';
  section: 'js' | 'py' | 'fin';
  chapterNum: number;
  qIndex: number;
  questionTitle: string;
  description: string;
  status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  adminNote?: string | null;
}): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(payload.id) || !isValidFirestoreId(payload.questionKey)) return;
  try {
    const ref = doc(db, 'question_reports', payload.id);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    const data: Record<string, unknown> = {
      id: payload.id,
      reporterUid: isValidFirestoreId(payload.reporterUid) ? payload.reporterUid : 'guest_report',
      questionKey: payload.questionKey,
      grade: payload.grade,
      section: payload.section,
      chapterNum: Math.max(1, Math.round(payload.chapterNum)),
      qIndex: Math.max(0, Math.round(payload.qIndex)),
      questionTitle: payload.questionTitle.trim().slice(0, 300),
      description: payload.description.trim().slice(0, 600),
      status: payload.status || 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (payload.adminNote) data.adminNote = payload.adminNote.slice(0, 500);
    await setDoc(ref, data);
  } catch {
    // Non-fatal
  }
}

export async function listQuestionReportsAdminCloud() {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(query(collection(db, 'question_reports'), limit(200)));
    return snap.docs
      .map((d) => {
        const r = d.data();
        return {
          id: d.id,
          questionKey: String(r.questionKey || ''),
          grade: (r.grade === 'bac2' ? 'bac2' : 'bac1') as 'bac1' | 'bac2',
          section: (r.section === 'py' || r.section === 'fin' ? r.section : 'js') as 'js' | 'py' | 'fin',
          chapterNum: Number(r.chapterNum || 1),
          qIndex: Number(r.qIndex || 0),
          questionTitle: String(r.questionTitle || ''),
          description: String(r.description || ''),
          status: (r.status || 'pending') as 'pending' | 'reviewed' | 'resolved' | 'dismissed',
          adminNote: typeof r.adminNote === 'string' ? r.adminNote : null,
          createdAt: toIsoString(r.createdAt),
          updatedAt: r.updatedAt ? toIsoString(r.updatedAt) : null,
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function updateQuestionReportCloud(
  id: string,
  payload: { status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed'; adminNote?: string }
): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(id)) return;
  try {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (payload.status) updates.status = payload.status;
    if (typeof payload.adminNote === 'string') updates.adminNote = payload.adminNote.slice(0, 500);
    await updateDoc(doc(db, 'question_reports', id), updates);
  } catch {
    // Non-fatal
  }
}

export interface LibraryOverrideItem {
  id: string;
  grade: 'bac1' | 'bac2';
  section: 'js' | 'py' | 'fin';
  chapterNum: number;
  qIndex: number;
  qText: string;
  aText: string;
  isCode: boolean;
  deleted: boolean;
}

export function subscribeLibraryOverridesCloud(
  onUpdate: (items: LibraryOverrideItem[]) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'library_overrides'), limit(500)),
    (snap) => {
      const items: LibraryOverrideItem[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          grade: x.grade === 'bac2' ? 'bac2' : 'bac1',
          section: x.section === 'py' || x.section === 'fin' ? x.section : 'js',
          chapterNum: Number(x.chapterNum || 1),
          qIndex: Number(x.qIndex || 0),
          qText: String(x.qText || ''),
          aText: String(x.aText || ''),
          isCode: Boolean(x.isCode),
          deleted: Boolean(x.deleted),
        };
      });
      onUpdate(items);
    },
    () => {
      // ignore
    }
  );
}

export async function saveLibraryOverrideCloud(item: LibraryOverrideItem): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(item.id)) return;
  try {
    await setDoc(doc(db, 'library_overrides', item.id), {
      id: item.id,
      grade: item.grade,
      section: item.section,
      chapterNum: Math.max(1, Math.round(item.chapterNum)),
      qIndex: Math.max(0, Math.round(item.qIndex)),
      qText: item.qText.trim().slice(0, 2000) || 'سؤال',
      aText: item.aText.trim().slice(0, 8000) || '-',
      isCode: Boolean(item.isCode),
      deleted: Boolean(item.deleted),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal
  }
}

// ==================== ADMIN USERS, ACTIVITIES & COMMENTS SYNC ====================

export async function listAllUsersAdminCloud(): Promise<AdminUserItem[]> {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(500)));
    return snap.docs
      .map((d) => {
        const u = d.data();
        return {
          id: d.id,
          serialNumber: normalizeSerialNumber(u.serialNumber),
          name: String(u.name || ''),
          email: String(u.email || ''),
          grade: (u.grade === 'bac2' ? 'bac2' : 'bac1') as 'bac1' | 'bac2',
          role: (u.role === 'admin' ? 'admin' : 'user') as 'user' | 'admin',
          status: (u.status === 'suspended' ? 'suspended' : 'active') as 'active' | 'suspended',
          suspendReason: null,
          lastActiveAt: u.updatedAt ? toIsoString(u.updatedAt) : null,
          createdAt: toIsoString(u.createdAt),
          reviewsCount: 0,
          votesCount: 0,
          completedOrdersCount: 0,
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function fetchUserActivitiesCloud(uid: string) {
  const targetUid = normalizeCloudUserId(uid);
  if (!auth.currentUser || !targetUid || targetUid.startsWith('usr_') || !isValidFirestoreId(targetUid)) return [];
  try {
    const snap = await getDocs(query(collection(db, 'users', targetUid, 'activities'), limit(150)));
    return snap.docs
      .map((d) => {
        const a = d.data();
        return {
          id: d.id,
          eventType: String(a.eventType || 'activity'),
          path: typeof a.path === 'string' && a.path ? a.path : null,
          grade: null,
          section: null,
          chapterNum: null,
          query: typeof a.label === 'string' ? a.label : null,
          resultsCount: null,
          metaJson: typeof a.detail === 'string' && a.detail ? JSON.stringify({ detail: a.detail }) : null,
          createdAt: toIsoString(a.createdAt),
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function updateUserAdminCloud(
  uid: string,
  payload: { role?: 'user' | 'admin'; status?: 'active' | 'suspended'; grade?: 'bac1' | 'bac2' }
): Promise<void> {
  const targetUid = normalizeCloudUserId(uid);
  if (!auth.currentUser || !targetUid || targetUid.startsWith('usr_') || !isValidFirestoreId(targetUid)) return;
  try {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (payload.role) updates.role = payload.role;
    if (payload.status) updates.status = payload.status;
    if (payload.grade) updates.grade = payload.grade;
    await updateDoc(doc(db, 'users', targetUid), updates);
  } catch {
    // Non-fatal
  }
}

export async function listAllCommentsAdminCloud() {
  if (!auth.currentUser) return [];
  try {
    const snap = await getDocs(query(collection(db, 'comments'), limit(250)));
    return snap.docs
      .map((d) => {
        const c = d.data();
        const beforeUrl = typeof c.attachmentBeforeDataUrl === 'string' && c.attachmentBeforeDataUrl ? c.attachmentBeforeDataUrl : null;
        const afterUrl = typeof c.attachmentAfterDataUrl === 'string' && c.attachmentAfterDataUrl ? c.attachmentAfterDataUrl : null;
        return {
          id: d.id,
          authorName: String(c.authorName || ''),
          grade: String(c.grade || ''),
          rating: Number(c.rating || 5),
          content: String(c.content || ''),
          avatarUrl: typeof c.avatarDataUrl === 'string' ? c.avatarDataUrl : null,
          attachmentUrl: beforeUrl,
          attachmentBeforeUrl: beforeUrl,
          attachmentAfterUrl: afterUrl,
          contactPhone: null,
          showContactPublicly: false,
          isVerified: Boolean(c.isVerified),
          status: (c.status || 'approved') as 'approved' | 'hidden' | 'flagged',
          likesCount: Math.max(0, Number(c.likesCount || 0)),
          reportsCount: Math.max(0, Number(c.reportsCount || 0)),
          reports: [],
          createdAt: toIsoString(c.createdAt),
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function updateCommentAdminCloud(
  id: string,
  payload: { isVerified?: boolean; status?: 'approved' | 'hidden' | 'flagged'; clearReports?: boolean }
): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(id)) return;
  try {
    const updates: Record<string, unknown> = {};
    if (typeof payload.isVerified === 'boolean') updates.isVerified = payload.isVerified;
    if (payload.status) updates.status = payload.status;
    if (payload.clearReports) updates.reportsCount = 0;
    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, 'comments', id), updates);
    }
  } catch {
    // Non-fatal
  }
}

export async function deleteCommentAdminCloud(id: string): Promise<void> {
  if (!auth.currentUser || !isValidFirestoreId(id)) return;
  try {
    await deleteDoc(doc(db, 'comments', id));
  } catch {
    // Non-fatal
  }
}
