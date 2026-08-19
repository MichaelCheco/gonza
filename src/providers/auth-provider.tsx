import { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { queryClient } from '@/lib/query-client';
import { supabase } from '../../utils/supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'checkingAccess' | 'authorized' | 'unauthorized';
export type AppRole = 'admin' | 'client';

type AuthContextType = {
  session: Session | null;
  status: AuthStatus;
  role: AppRole | null;
  clientId: number | null;
  message: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearAuthMessage: () => void;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  status: 'loading',
  role: null,
  clientId: null,
  message: null,
  signInWithEmail: async () => undefined,
  signUpWithEmail: async () => undefined,
  signOut: async () => undefined,
  clearAuthMessage: () => undefined,
});

const UNAUTHORIZED_MESSAGE = 'This account is not linked to a gym member profile. Ask the gym to add the same email address to your client record.';
const AUTH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);

    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function getFriendlySignInError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login') || normalized.includes('invalid credentials')) {
    return 'The email or password is incorrect.';
  }

  if (normalized.includes('email not confirmed')) {
    return 'Please confirm this email address before signing in.';
  }

  return 'We could not sign you in. Please check the account and try again.';
}

function getFriendlySignUpError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes('password')) {
    return 'Use a stronger password with at least 6 characters.';
  }

  if (normalized.includes('already') || normalized.includes('registered')) {
    return 'An account already exists for this email. Sign in instead.';
  }

  return 'We could not create the account. Check the details and try again.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [role, setRole] = useState<AppRole | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const accessCheckIdRef = useRef(0);
  const unauthorizedSignOutRef = useRef(false);
  const verifiedUserIdRef = useRef<string | null>(null);

  const clearProtectedState = useCallback(() => {
    queryClient.clear();
    setRole(null);
    setClientId(null);
  }, []);

  const verifyAccess = useCallback(async (nextSession: Session) => {
    if (verifiedUserIdRef.current === nextSession.user.id) {
      setSession(nextSession);
      return;
    }

    const checkId = accessCheckIdRef.current + 1;
    accessCheckIdRef.current = checkId;
    setSession(nextSession);
    setStatus('checkingAccess');
    setMessage(null);

    try {
      const adminResult = await withTimeout(
        supabase
          .from('app_admins')
          .select('user_id')
          .eq('user_id', nextSession.user.id)
          .maybeSingle(),
        AUTH_TIMEOUT_MS,
        'Timed out while checking app access.'
      );

      if (accessCheckIdRef.current !== checkId) return;

      if (!adminResult.error && adminResult.data) {
        verifiedUserIdRef.current = nextSession.user.id;
        setRole('admin');
        setClientId(null);
        setStatus('authorized');
        return;
      }

      const clientResult = await withTimeout(
        supabase.rpc('claim_client_profile'),
        AUTH_TIMEOUT_MS,
        'Timed out while linking the member profile.'
      );

      if (accessCheckIdRef.current !== checkId) return;

      const linkedClientId = typeof clientResult.data === 'number'
        ? clientResult.data
        : Number(clientResult.data);

      if (!clientResult.error && Number.isFinite(linkedClientId) && linkedClientId > 0) {
        verifiedUserIdRef.current = nextSession.user.id;
        setRole('client');
        setClientId(linkedClientId);
        setStatus('authorized');
        return;
      }
    } catch {
      // The common failure path below keeps auth errors intentionally non-sensitive.
    }

    if (accessCheckIdRef.current !== checkId) return;

    unauthorizedSignOutRef.current = true;
    verifiedUserIdRef.current = null;
    clearProtectedState();
    setSession(null);
    setStatus('unauthorized');
    setMessage(UNAUTHORIZED_MESSAGE);
    await supabase.auth.signOut();
  }, [clearProtectedState]);

  useEffect(() => {
    withTimeout(
      supabase.auth.getSession(),
      AUTH_TIMEOUT_MS,
      'Timed out while restoring your session.'
    )
      .then(({ data: { session: initialSession } }) => {
        if (initialSession) {
          verifyAccess(initialSession);
        } else {
          setSession(null);
          setStatus('signedOut');
        }
      })
      .catch(() => {
        clearProtectedState();
        setSession(null);
        setStatus('signedOut');
        setMessage('We could not restore your session. Please sign in again.');
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' || !nextSession) {
        accessCheckIdRef.current += 1;
        verifiedUserIdRef.current = null;
        clearProtectedState();
        setSession(null);

        if (unauthorizedSignOutRef.current) {
          unauthorizedSignOutRef.current = false;
          setStatus('unauthorized');
          setMessage(UNAUTHORIZED_MESSAGE);
        } else {
          setStatus('signedOut');
        }
        return;
      }

      verifyAccess(nextSession);
    });

    return () => subscription.unsubscribe();
  }, [clearProtectedState, verifyAccess]);

  const signInWithEmail = async (email: string, password: string) => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setStatus('signedOut');
      setMessage('Enter your email and password.');
      return;
    }

    setMessage(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });

    if (error) {
      clearProtectedState();
      setSession(null);
      setStatus('signedOut');
      setMessage(getFriendlySignInError(error.message));
      return;
    }

    if (data.session) {
      await verifyAccess(data.session);
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setStatus('signedOut');
      setMessage('Enter your email and password.');
      return;
    }

    setMessage(null);
    const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });

    if (error) {
      setStatus('signedOut');
      setMessage(getFriendlySignUpError(error.message));
      return;
    }

    if (data.session) {
      await verifyAccess(data.session);
      return;
    }

    setStatus('signedOut');
    setMessage('Check your email to confirm the account, then sign in. Your account email must match your gym profile.');
  };

  const signOut = async () => {
    accessCheckIdRef.current += 1;
    verifiedUserIdRef.current = null;
    clearProtectedState();
    setSession(null);
    setStatus('signedOut');
    setMessage(null);
    await supabase.auth.signOut();
  };

  const clearAuthMessage = () => setMessage(null);

  return (
    <AuthContext.Provider value={{
      session,
      status,
      role,
      clientId,
      message,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      clearAuthMessage,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
