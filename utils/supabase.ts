import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const serverStorage = {
    getItem: async (_key: string) => null,
    setItem: async (_key: string, _value: string) => undefined,
    removeItem: async (_key: string) => undefined,
}

const authStorage = process.env.EXPO_OS === 'web' && typeof window === 'undefined'
    ? serverStorage
    : AsyncStorage

export const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_KEY!,
    {
        auth: {
            storage: authStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
        },
    })
