import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/providers/auth-provider';

export default function AuthScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const { status, message, signInWithEmail, clearAuthMessage } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const checkingAccess = status === 'checkingAdmin';
    const busy = submitting || checkingAccess;
    const hasCredentials = email.trim().length > 0 && password.length > 0;
    const canSubmit = hasCredentials && !busy;

    const handleEmailChange = (value: string) => {
        setEmail(value);
        if (message) clearAuthMessage();
    };

    const handlePasswordChange = (value: string) => {
        setPassword(value);
        if (message) clearAuthMessage();
    };

    const handleSignIn = async () => {
        if (!canSubmit) return;

        setSubmitting(true);
        await signInWithEmail(email, password);
        setSubmitting(false);
    };

    return (
        <ThemedView style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView
                    style={styles.keyboardView}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[
                            styles.scrollContent,
                            { paddingBottom: Math.max(insets.bottom, Spacing.four) },
                        ]}
                    >
                        <View style={styles.content}>
                            <View style={styles.header}>
                                <ThemedText style={styles.title}>Gonza Boxing</ThemedText>
                                <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                                    Owner test access for the gym schedule and client roster.
                                </ThemedText>
                            </View>

                            <View style={styles.form}>
                                <View style={styles.inputContainer}>
                                    <ThemedText style={styles.label}>Email</ThemedText>
                                    <TextInput
                                        style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.backgroundElement }]}
                                        onChangeText={handleEmailChange}
                                        value={email}
                                        placeholder="owner@example.com"
                                        placeholderTextColor={theme.textSecondary}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="email-address"
                                        textContentType="username"
                                        editable={!busy}
                                        returnKeyType="next"
                                    />
                                </View>

                                <View style={styles.inputContainer}>
                                    <ThemedText style={styles.label}>Password</ThemedText>
                                    <TextInput
                                        style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.backgroundElement }]}
                                        onChangeText={handlePasswordChange}
                                        value={password}
                                        placeholder="Password"
                                        placeholderTextColor={theme.textSecondary}
                                        secureTextEntry
                                        autoCapitalize="none"
                                        textContentType="password"
                                        editable={!busy}
                                        returnKeyType="go"
                                        onSubmitEditing={handleSignIn}
                                    />
                                </View>

                                {message && (
                                    <View style={[styles.messageBox, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}>
                                        <ThemedText style={[styles.messageText, { color: status === 'unauthorized' ? theme.warning : theme.primary }]}>
                                            {message}
                                        </ThemedText>
                                    </View>
                                )}

                                {checkingAccess && (
                                    <ThemedText themeColor="textSecondary" style={styles.statusText}>
                                        Checking owner access...
                                    </ThemedText>
                                )}

                                <TouchableOpacity
                                    style={[
                                        styles.button,
                                        { backgroundColor: hasCredentials ? theme.primary : theme.backgroundSelected },
                                    ]}
                                    disabled={!canSubmit}
                                    onPress={handleSignIn}
                                    activeOpacity={0.8}
                                >
                                    {busy ? (
                                        <ActivityIndicator size="small" color={hasCredentials ? theme.onPrimary : theme.textSecondary} />
                                    ) : (
                                        <ThemedText style={[styles.buttonText, { color: hasCredentials ? theme.onPrimary : theme.textSecondary }]}>
                                            Sign In
                                        </ThemedText>
                                    )}
                                </TouchableOpacity>
                            </View>

                            <ThemedText themeColor="textSecondary" style={styles.ownerOnlyText}>
                                Need access? Ask the app owner to add your Supabase Auth user to the app_admins allowlist.
                            </ThemedText>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    keyboardView: { flex: 1 },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: Spacing.four,
        paddingTop: Spacing.four,
    },
    content: {
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
    },
    header: {
        marginBottom: Spacing.four,
    },
    title: { fontSize: 32, fontWeight: '800', marginBottom: Spacing.one },
    subtitle: { fontSize: 16, lineHeight: 22 },
    form: { gap: Spacing.three },
    inputContainer: { gap: Spacing.one },
    label: { fontSize: 13, fontWeight: '600' },
    input: { borderWidth: 1, borderRadius: Spacing.two, padding: 14, fontSize: 15 },
    messageBox: { borderWidth: 1, borderRadius: Spacing.two, padding: 12 },
    messageText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
    statusText: { fontSize: 13, textAlign: 'center' },
    button: { minHeight: 48, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
    buttonText: { fontWeight: '700', fontSize: 16 },
    ownerOnlyText: { marginTop: Spacing.four, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
