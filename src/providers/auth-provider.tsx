import { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../../utils/supabase';

type AuthContextType = {
    session: Session | null | undefined;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({ session: undefined, signOut: async () => undefined });

export function AuthProvider({ children }: { children: React.ReactNode }) {
    // undefined means loading, null means unauthenticated
    const [session, setSession] = useState<Session | null | undefined>(undefined);

    useEffect(() => {
        // Check initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        // Listen for auth events (login, logout, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{ session, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
