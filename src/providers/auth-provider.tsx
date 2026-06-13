import { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { queryClient } from '@/lib/query-client';
import { supabase } from '../../utils/supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'checkingAdmin' | 'authorized' | 'unauthorized';

type AuthContextType = {
    session: Session | null;
    status: AuthStatus;
    message: string | null;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    clearAuthMessage: () => void;
};

const AuthContext = createContext<AuthContextType>({
    session: null,
    status: 'loading',
    message: null,
    signInWithEmail: async () => undefined,
    signOut: async () => undefined,
    clearAuthMessage: () => undefined,
});

const UNAUTHORIZED_MESSAGE = 'This account can sign in, but it has not been granted app access yet.';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [status, setStatus] = useState<AuthStatus>('loading');
    const [message, setMessage] = useState<string | null>(null);
    const adminCheckIdRef = useRef(0);
    const unauthorizedSignOutRef = useRef(false);

    const clearProtectedState = useCallback(() => {
        queryClient.clear();
    }, []);

    const verifyAdminAccess = useCallback(async (nextSession: Session) => {
        const checkId = adminCheckIdRef.current + 1;
        adminCheckIdRef.current = checkId;

        setSession(nextSession);
        setStatus('checkingAdmin');

        const { data, error } = await supabase
            .from('app_admins')
            .select('user_id')
            .eq('user_id', nextSession.user.id)
            .maybeSingle();

        if (adminCheckIdRef.current !== checkId) return;

        if (error || !data) {
            unauthorizedSignOutRef.current = true;
            clearProtectedState();
            setSession(null);
            setStatus('unauthorized');
            setMessage(UNAUTHORIZED_MESSAGE);
            await supabase.auth.signOut();
            return;
        }

        setSession(nextSession);
        setStatus('authorized');
        setMessage(null);
    }, [clearProtectedState]);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
            if (initialSession) {
                verifyAdminAccess(initialSession);
            } else {
                setSession(null);
                setStatus('signedOut');
            }
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
            if (event === 'SIGNED_OUT' || !nextSession) {
                adminCheckIdRef.current += 1;
                clearProtectedState();
                setSession(null);

                if (unauthorizedSignOutRef.current) {
                    unauthorizedSignOutRef.current = false;
                    setStatus('unauthorized');
                    setMessage(UNAUTHORIZED_MESSAGE);
                } else {
                    setStatus('signedOut');
                    setMessage(null);
                }

                return;
            }

            verifyAdminAccess(nextSession);
        });

        return () => subscription.unsubscribe();
    }, [clearProtectedState, verifyAdminAccess]);

    const signInWithEmail = async (email: string, password: string) => {
        const trimmedEmail = email.trim();

        if (!trimmedEmail || !password) {
            setStatus('signedOut');
            setMessage('Enter the owner email and password.');
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
            await verifyAdminAccess(data.session);
        } else {
            setStatus('checkingAdmin');
        }
    };

    const signOut = async () => {
        adminCheckIdRef.current += 1;
        clearProtectedState();
        setSession(null);
        setStatus('signedOut');
        setMessage(null);
        await supabase.auth.signOut();
    };

    const clearAuthMessage = () => setMessage(null);

    return (
        <AuthContext.Provider value={{ session, status, message, signInWithEmail, signOut, clearAuthMessage }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
