import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppSymbol } from '@/components/app-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  ClientProfileUpdate,
  clientQueryKeys,
  fetchClientProfile,
  updateClientProfile,
} from '@/lib/client-queries';
import { useAuth } from '@/providers/auth-provider';
import { getClientPackageStatus } from '@/utils/gym-logic';

const EXPERIENCE_LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'professional', label: 'Pro' },
] as const;

const EMPTY_FORM: ClientProfileUpdate = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  instagramHandle: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  experienceLevel: null,
};

export default function ClientProfileScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { clientId, signOut } = useAuth();
  const [draft, setDraft] = useState<Partial<ClientProfileUpdate>>({});
  const profileQuery = useQuery({
    queryKey: clientQueryKeys.profile(clientId),
    queryFn: () => fetchClientProfile(clientId!),
    enabled: !!clientId,
  });

  const baseForm = useMemo<ClientProfileUpdate>(() => {
    if (!profileQuery.data) return EMPTY_FORM;

    return {
      firstName: profileQuery.data.firstName,
      lastName: profileQuery.data.lastName,
      email: profileQuery.data.email,
      phone: profileQuery.data.phone,
      instagramHandle: profileQuery.data.instagramHandle,
      emergencyContactName: profileQuery.data.emergencyContactName,
      emergencyContactPhone: profileQuery.data.emergencyContactPhone,
      experienceLevel: profileQuery.data.experienceLevel,
    };
  }, [profileQuery.data]);
  const form = { ...baseForm, ...draft };

  const membership = useMemo(() => (
    profileQuery.data?.clientPackages.find((clientPackage) => (
      clientPackage.packages?.package_kind === 'membership'
      && getClientPackageStatus(clientPackage).active
    )) ?? null
  ), [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => updateClientProfile(clientId!, form),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientQueryKeys.profile(clientId) });
      Alert.alert('Profile Saved', 'Your contact and training details are up to date.');
    },
    onError: (error) => Alert.alert('Profile Not Saved', error.message),
  });

  const setField = <K extends keyof ClientProfileUpdate>(field: K, value: ClientProfileUpdate[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSave = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      Alert.alert('Name Required', 'Enter your first and last name.');
      return;
    }

    saveMutation.mutate();
  };

  const requestSignOut = () => {
    Alert.alert('Sign Out?', 'You can sign back in with your member email and password.', [
      { text: 'Stay Signed In', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const renderInput = (
    label: string,
    field: keyof ClientProfileUpdate,
    options?: { keyboardType?: 'default' | 'email-address' | 'phone-pad'; placeholder?: string; autoCapitalize?: 'none' | 'words' }
  ) => (
    <View style={styles.inputGroup}>
      <ThemedText style={styles.inputLabel}>{label}</ThemedText>
      <TextInput
        value={(form[field] as string | null) ?? ''}
        onChangeText={(value) => setField(field, value as never)}
        placeholder={options?.placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={options?.keyboardType ?? 'default'}
        autoCapitalize={options?.autoCapitalize ?? 'words'}
        autoCorrect={false}
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected, color: theme.text },
        ]}
      />
    </View>
  );

  if (profileQuery.isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.primary} />
        <ThemedText themeColor="textSecondary">Loading profile…</ThemedText>
      </ThemedView>
    );
  }

  if (profileQuery.error || !profileQuery.data) {
    return (
      <ThemedView style={styles.centered}>
        <AppSymbol name="exclamationmark.triangle.fill" size={30} tintColor={theme.warning} />
        <ThemedText style={styles.errorTitle}>Profile unavailable</ThemedText>
        <ThemedText selectable themeColor="textSecondary" style={styles.errorText}>
          {profileQuery.error?.message ?? 'Your member profile could not be loaded.'}
        </ThemedText>
        <Pressable style={[styles.retryButton, { backgroundColor: theme.primary }]} onPress={() => profileQuery.refetch()}>
          <ThemedText style={{ color: theme.onPrimary, fontWeight: '900' }}>Try Again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const profile = profileQuery.data;
  const membershipLabel = membership
    ? membership.expiration_date
      ? `Active through ${dayjs(membership.expiration_date).format('MMM D, YYYY')}`
      : 'Active membership'
    : 'No active membership';
  const groupBalance = profile.groupSummary.hasUnlimited
    ? 'Unlimited'
    : `${profile.groupSummary.usableClasses}`;
  const ptBalance = profile.ptSummary.hasUnlimited
    ? 'Unlimited'
    : `${profile.ptSummary.usableClasses}`;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        <View style={[styles.membershipCard, { backgroundColor: theme.surface, borderColor: theme.backgroundSelected }]}>
          <View style={styles.membershipHeader}>
            <View style={[styles.membershipIcon, { backgroundColor: membership ? theme.primary : theme.backgroundElement }]}>
              <AppSymbol name="checkmark.circle.fill" size={22} tintColor={membership ? theme.onPrimary : theme.textSecondary} />
            </View>
            <View style={styles.membershipText}>
              <ThemedText style={styles.membershipTitle}>Membership</ThemedText>
              <ThemedText selectable style={[styles.membershipStatus, { color: membership ? theme.success : theme.textSecondary }]}>
                {membershipLabel}
              </ThemedText>
            </View>
          </View>

          <View style={[styles.balanceRow, { borderTopColor: theme.backgroundSelected }]}>
            <View style={styles.balanceItem}>
              <ThemedText themeColor="textSecondary" style={styles.balanceLabel}>Group passes</ThemedText>
              <ThemedText selectable style={styles.balanceValue}>{groupBalance}</ThemedText>
            </View>
            <View style={[styles.balanceDivider, { backgroundColor: theme.backgroundSelected }]} />
            <View style={styles.balanceItem}>
              <ThemedText themeColor="textSecondary" style={styles.balanceLabel}>1-on-1 credits</ThemedText>
              <ThemedText selectable style={styles.balanceValue}>{ptBalance}</ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Contact Details</ThemedText>
          <View style={styles.twoColumnRow}>
            <View style={styles.halfField}>{renderInput('First name', 'firstName', { placeholder: 'First name' })}</View>
            <View style={styles.halfField}>{renderInput('Last name', 'lastName', { placeholder: 'Last name' })}</View>
          </View>
          {renderInput('Email', 'email', { keyboardType: 'email-address', autoCapitalize: 'none', placeholder: 'you@example.com' })}
          <ThemedText themeColor="textSecondary" style={styles.inputHelp}>
            This is your contact email. Changing it here does not change your sign-in email.
          </ThemedText>
          {renderInput('Phone', 'phone', { keyboardType: 'phone-pad', autoCapitalize: 'none', placeholder: '(555) 555-5555' })}
          {renderInput('Instagram', 'instagramHandle', { autoCapitalize: 'none', placeholder: '@handle' })}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Emergency Contact</ThemedText>
          {renderInput('Name', 'emergencyContactName', { placeholder: 'Contact name' })}
          {renderInput('Phone', 'emergencyContactPhone', { keyboardType: 'phone-pad', autoCapitalize: 'none', placeholder: '(555) 555-5555' })}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Boxing Experience</ThemedText>
          <View style={styles.experienceGrid}>
            {EXPERIENCE_LEVELS.map((level) => {
              const selected = form.experienceLevel === level.value;
              return (
                <Pressable
                  key={level.value}
                  onPress={() => setField('experienceLevel', level.value)}
                  style={[
                    styles.experienceButton,
                    {
                      backgroundColor: selected ? theme.primary : theme.backgroundElement,
                      borderColor: selected ? theme.primary : theme.backgroundSelected,
                    },
                  ]}
                >
                  <ThemedText style={[styles.experienceText, { color: selected ? theme.onPrimary : theme.text }]}>
                    {level.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={saveMutation.isPending}
          style={[styles.saveButton, { backgroundColor: theme.primary }]}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <ThemedText style={[styles.saveText, { color: theme.onPrimary }]}>Save Profile</ThemedText>
          )}
        </Pressable>

        <Pressable onPress={requestSignOut} style={[styles.signOutButton, { borderColor: theme.backgroundSelected }]}>
          <AppSymbol name="rectangle.portrait.and.arrow.right" size={17} tintColor={theme.primary} />
          <ThemedText style={[styles.signOutText, { color: theme.primary }]}>Sign Out</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.four },
  membershipCard: { borderWidth: 1, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden' },
  membershipHeader: { padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: 12 },
  membershipIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  membershipText: { flex: 1, gap: 2 },
  membershipTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  membershipStatus: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  balanceRow: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', padding: 14, alignItems: 'center' },
  balanceItem: { flex: 1, gap: 2 },
  balanceDivider: { width: 1, height: 38, marginHorizontal: Spacing.three },
  balanceLabel: { fontSize: 10, lineHeight: 13, fontWeight: '900', textTransform: 'uppercase' },
  balanceValue: { fontSize: 22, lineHeight: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  section: { gap: Spacing.two },
  sectionTitle: { fontSize: 15, lineHeight: 19, fontWeight: '900', textTransform: 'uppercase', paddingBottom: 2 },
  twoColumnRow: { flexDirection: 'row', gap: Spacing.two },
  halfField: { flex: 1 },
  inputGroup: { gap: 5 },
  inputLabel: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 11, borderCurve: 'continuous', paddingHorizontal: 13, fontSize: 15 },
  inputHelp: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  experienceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  experienceButton: { minWidth: '47%', flexGrow: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  experienceText: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  saveButton: { minHeight: 52, borderRadius: 13, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  signOutButton: { minHeight: 48, borderWidth: 1, borderRadius: 13, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  signOutText: { fontSize: 14, lineHeight: 18, fontWeight: '900' },
  errorTitle: { fontSize: 18, lineHeight: 22, fontWeight: '900' },
  errorText: { maxWidth: 320, textAlign: 'center', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  retryButton: { minHeight: 40, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
});
