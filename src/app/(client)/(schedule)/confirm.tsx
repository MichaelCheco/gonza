import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppSymbol } from '@/components/app-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  bookClientSession,
  clientQueryKeys,
  fetchBookableSchedule,
  fetchClientGymSettings,
  fetchClientProfile,
  SessionKind,
} from '@/lib/client-queries';
import { useAuth } from '@/providers/auth-provider';

export default function ConfirmBookingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clientId } = useAuth();
  const params = useLocalSearchParams<{ kind?: string; id?: string; date?: string }>();
  const kind = params.kind === 'personal_training' ? 'personal_training' : 'group';
  const sessionId = typeof params.id === 'string' ? params.id : '';
  const date = typeof params.date === 'string' ? params.date : dayjs().format('YYYY-MM-DD');

  const scheduleQuery = useQuery({
    queryKey: clientQueryKeys.schedule(date),
    queryFn: () => fetchBookableSchedule(date),
  });
  const profileQuery = useQuery({
    queryKey: clientQueryKeys.profile(clientId),
    queryFn: () => fetchClientProfile(clientId!),
    enabled: !!clientId,
  });
  const settingsQuery = useQuery({
    queryKey: clientQueryKeys.settings,
    queryFn: fetchClientGymSettings,
  });
  const session = scheduleQuery.data?.find((item) => item.kind === kind && item.id === sessionId);
  const profile = profileQuery.data;
  const entitlement = kind === 'group' ? profile?.groupSummary : profile?.ptSummary;
  const hasCredit = !!entitlement && (entitlement.hasUnlimited || entitlement.usableClasses > 0);
  const cancellationHours = settingsQuery.data?.cancellationWindowHours ?? 24;
  const cutoff = session ? dayjs(session.startsAt).subtract(cancellationHours, 'hour') : null;
  const afterCutoff = cutoff ? dayjs().isAfter(cutoff) : false;

  const bookingMutation = useMutation({
    mutationFn: ({ sessionKind, id }: { sessionKind: SessionKind; id: string }) => (
      bookClientSession(sessionKind, id)
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clientQueryKeys.schedules }),
        queryClient.invalidateQueries({ queryKey: clientQueryKeys.profile(clientId) }),
        queryClient.invalidateQueries({ queryKey: clientQueryKeys.bookings(clientId) }),
      ]);
      router.replace('/bookings' as Href);
    },
    onError: (error) => {
      Alert.alert('Booking Not Completed', error.message);
      scheduleQuery.refetch();
      profileQuery.refetch();
    },
  });

  const confirmBooking = () => {
    if (!session || bookingMutation.isPending) return;

    Alert.alert(
      'Confirm Booking',
      afterCutoff
        ? 'This session is inside the cancellation window. Booking now means this credit will not be refunded if you cancel.'
        : `One ${kind === 'group' ? 'group class' : 'PT'} credit will be applied. Cancel at least ${cancellationHours} hours before the session for a refund.`,
      [
        { text: 'Not Yet', style: 'cancel' },
        {
          text: 'Book Session',
          onPress: () => bookingMutation.mutate({ sessionKind: kind, id: session.id }),
        },
      ]
    );
  };

  const loading = scheduleQuery.isLoading || profileQuery.isLoading || settingsQuery.isLoading;

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.primary} />
        <ThemedText themeColor="textSecondary">Checking availability…</ThemedText>
      </ThemedView>
    );
  }

  if (!session) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.missingContent}>
          <AppSymbol name="exclamationmark.triangle.fill" size={32} tintColor={theme.warning} />
          <ThemedText style={styles.missingTitle}>Session no longer available</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.missingText}>
            Another member may have booked this slot, or the schedule changed. Return to the schedule for current options.
          </ThemedText>
          <Pressable style={[styles.primaryButton, { backgroundColor: theme.primary }]} onPress={() => router.back()}>
            <ThemedText style={[styles.primaryButtonText, { color: theme.onPrimary }]}>Back to Schedule</ThemedText>
          </Pressable>
        </ScrollView>
      </ThemedView>
    );
  }

  const start = dayjs(session.startsAt);
  const end = dayjs(session.endsAt);
  const remainingLabel = entitlement?.hasUnlimited
    ? 'Unlimited membership'
    : `${entitlement?.usableClasses ?? 0} before booking`;
  const disabledReason = session.isBooked
    ? 'You already have this booking.'
    : session.spotsRemaining <= 0
      ? 'This session is full.'
      : !hasCredit
        ? `You need an active ${kind === 'group' ? 'group pass' : 'PT credit'} to book.`
        : null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <View style={[styles.heroCard, { backgroundColor: theme.surface, borderColor: theme.backgroundSelected }]}>
          <View style={[styles.iconCircle, { backgroundColor: kind === 'personal_training' ? theme.primary : theme.backgroundElement }]}>
            <AppSymbol
              name={kind === 'personal_training' ? 'person.3.fill' : 'calendar'}
              size={24}
              tintColor={kind === 'personal_training' ? theme.onPrimary : theme.primary}
            />
          </View>
          <View style={styles.heroText}>
            <ThemedText selectable style={styles.sessionTitle}>{session.title}</ThemedText>
            <ThemedText selectable themeColor="textSecondary" style={styles.sessionMeta}>
              {start.format('dddd, MMMM D')}
            </ThemedText>
            <ThemedText selectable themeColor="textSecondary" style={styles.sessionMeta}>
              {start.format('h:mm A')}–{end.format('h:mm A')} • {session.coachName}
            </ThemedText>
          </View>
        </View>

        <View style={styles.detailSection}>
          <ThemedText style={styles.sectionTitle}>Booking Summary</ThemedText>
          <View style={[styles.detailCard, { backgroundColor: theme.surface }]}>
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary" style={styles.detailLabel}>Session type</ThemedText>
              <ThemedText selectable style={styles.detailValue}>{kind === 'group' ? 'Group class' : '1-on-1 PT'}</ThemedText>
            </View>
            <View style={[styles.rowDivider, { backgroundColor: theme.backgroundSelected }]} />
            <View style={styles.detailRow}>
              <ThemedText themeColor="textSecondary" style={styles.detailLabel}>Pass balance</ThemedText>
              <ThemedText selectable style={styles.detailValue}>{remainingLabel}</ThemedText>
            </View>
            {!entitlement?.hasUnlimited && hasCredit && (
              <>
                <View style={[styles.rowDivider, { backgroundColor: theme.backgroundSelected }]} />
                <View style={styles.detailRow}>
                  <ThemedText themeColor="textSecondary" style={styles.detailLabel}>After booking</ThemedText>
                  <ThemedText selectable style={styles.detailValue}>{Math.max((entitlement?.usableClasses ?? 1) - 1, 0)} remaining</ThemedText>
                </View>
              </>
            )}
          </View>
        </View>

        <View style={styles.detailSection}>
          <ThemedText style={styles.sectionTitle}>Cancellation Policy</ThemedText>
          <View style={[
            styles.policyCard,
            { backgroundColor: afterCutoff ? theme.backgroundElement : theme.surface, borderColor: afterCutoff ? theme.warning : theme.backgroundSelected },
          ]}>
            <AppSymbol
              name={afterCutoff ? 'exclamationmark.triangle.fill' : 'clock.arrow.circlepath'}
              size={22}
              tintColor={afterCutoff ? theme.warning : theme.success}
            />
            <View style={styles.policyText}>
              <ThemedText style={styles.policyTitle}>
                {afterCutoff ? 'Inside the cancellation window' : `${cancellationHours}-hour credit refund`}
              </ThemedText>
              <ThemedText selectable themeColor="textSecondary" style={styles.policyBody}>
                {afterCutoff
                  ? 'You can still cancel before the session starts, but the credit will not be returned.'
                  : `Cancel by ${cutoff?.format('ddd, MMM D [at] h:mm A')} to automatically return the credit.`}
              </ThemedText>
            </View>
          </View>
        </View>

        {disabledReason && (
          <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText selectable style={[styles.noticeText, { color: theme.warning }]}>{disabledReason}</ThemedText>
          </View>
        )}

        <Pressable
          onPress={confirmBooking}
          disabled={!!disabledReason || bookingMutation.isPending}
          style={[
            styles.primaryButton,
            { backgroundColor: disabledReason ? theme.backgroundSelected : theme.primary },
          ]}
        >
          {bookingMutation.isPending ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <ThemedText style={[
              styles.primaryButtonText,
              { color: disabledReason ? theme.textSecondary : theme.onPrimary },
            ]}>
              {session.isBooked ? 'Already Booked' : 'Confirm Booking'}
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.four },
  heroCard: { borderWidth: 1, borderRadius: 16, borderCurve: 'continuous', padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, minWidth: 0, gap: 2 },
  sessionTitle: { fontSize: 20, lineHeight: 24, fontWeight: '900' },
  sessionMeta: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  detailSection: { gap: Spacing.two },
  sectionTitle: { fontSize: 15, lineHeight: 19, fontWeight: '900', textTransform: 'uppercase' },
  detailCard: { borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 14 },
  detailRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  detailLabel: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 14, lineHeight: 18, fontWeight: '800' },
  rowDivider: { height: StyleSheet.hairlineWidth },
  policyCard: { borderWidth: 1, borderRadius: 14, borderCurve: 'continuous', padding: 14, flexDirection: 'row', gap: 12 },
  policyText: { flex: 1, gap: 3 },
  policyTitle: { fontSize: 14, lineHeight: 18, fontWeight: '900' },
  policyBody: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  notice: { borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  primaryButton: { minHeight: 52, borderRadius: 13, borderCurve: 'continuous', paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  missingContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  missingTitle: { fontSize: 20, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  missingText: { maxWidth: 340, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
});
