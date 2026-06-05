import { useState } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '../../utils/supabase';


export default function AuthScreen() {
    const theme = useTheme();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    async function signInWithEmail() {
        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) Alert.alert('Sign In Failed', error.message);
        setLoading(false);
    }

    async function signUpWithEmail() {
        setLoading(true);
        const { error } = await supabase.auth.signUp({ email, password });

        if (error) {
            Alert.alert('Sign Up Failed', error.message);
        }
        // If successful, the AuthProvider automatically detects the new session 
        // and the RootLayout routes the user directly into the app.

        setLoading(false);
    }

    return (
        <ThemedView style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.content}>
                    <ThemedText style={styles.title}>Welcome</ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                        Sign in or create an account to continue.
                    </ThemedText>

                    <View style={styles.inputContainer}>
                        <ThemedText style={styles.label}>Email</ThemedText>
                        <TextInput
                            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.backgroundElement }]}
                            onChangeText={setEmail}
                            value={email}
                            placeholderTextColor={theme.textSecondary}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />
                    </View>

                    <View style={styles.inputContainer}>
                        <ThemedText style={styles.label}>Password</ThemedText>
                        <TextInput
                            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.backgroundElement }]}
                            onChangeText={setPassword}
                            value={password}
                            secureTextEntry
                            placeholderTextColor={theme.textSecondary}
                            autoCapitalize="none"
                        />
                    </View>

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity
                            style={[styles.button, { backgroundColor: theme.primary }]}
                            disabled={loading}
                            onPress={signInWithEmail}
                        >
                            <ThemedText style={styles.buttonText}>Sign In</ThemedText>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.outlineButton, { borderColor: theme.primary }]}
                            disabled={loading}
                            onPress={signUpWithEmail}
                        >
                            <ThemedText style={[styles.buttonText, { color: theme.primary }]}>Sign Up</ThemedText>
                        </TouchableOpacity>
                    </View>
                </View>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1, justifyContent: 'center' },
    content: { paddingHorizontal: Spacing.four },
    title: { fontSize: 32, fontWeight: '800', marginBottom: Spacing.one },
    subtitle: { fontSize: 16, marginBottom: Spacing.five },
    inputContainer: { marginBottom: Spacing.three },
    label: { fontSize: 13, fontWeight: '600', marginBottom: Spacing.one },
    input: { borderWidth: 1, borderRadius: Spacing.two, padding: 14, fontSize: 15 },
    buttonContainer: { marginTop: Spacing.four, gap: Spacing.three },
    button: { paddingVertical: 14, borderRadius: Spacing.two, alignItems: 'center' },
    outlineButton: { backgroundColor: 'transparent', borderWidth: 1 },
    buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});