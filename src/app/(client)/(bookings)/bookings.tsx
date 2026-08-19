import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
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
  cancelClientBooking,
  ClientBooking,
  clientQueryKeys,
  fetchClientBookings,
} from '@/lib/client-queries';
import { useAuth } from '@/providers/auth-provider';

type BookingView = 'upcoming' | 'history';

const getHistoryStatus = (booking: ClientBooking) => {
  if (booking.status === 'attended') return { label: 'Attended', tone: 'success' as const };
  if (booking.status === 'no_show') return { label: 'No show', tone: 'warning' as const };
  if (booking.status === 'cancelled' && booking.creditRefundedAt) return { label: 'Cancelled • Refunded', tone: 'muted' as const };
  if (booking.status === 'cancelled') return { label: 'Late cancellation', tone: 'warning' as const };
  if (dayjs(booking.startsAt).isBefore(dayjs())) return { label: 'Attendance pending', tone: 'muted' as const };
  return { label: 'Booked', tone: 'success' as const };
};

export default function ClientBookingsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { clientId } = useAuth();
  const [view, setView] = useState<BookingView>('upcoming');
  const bookingsQuery = useQuery({
    queryKey: clientQueryKeys.bookings(clientId),
    queryFn: () => fetchClientBookings(clientId!),
    enabled: !!clientId,
  });

  const { upcoming, history } = useMemo(() => {
    const now = dayjs();
    const allBookings = bookingsQuery.data ?? [];

    return {
      upcoming: allBookings
        .filter((booking) => (
          (booking.status === 'booked' || booking.status === 'attended')
          && dayjs(booking.startsAt).isAfter(now)
        ))
        .sort((a, b) => dayjs(a.startsAt).valueOf() - dayjs(b.startsAt).valueOf()),
      history: allBookings
        .filter((booking) => (
          booking.status === 'cancelled'
          || booking.status === 'no_show'
          || dayjs(booking.startsAt).isSame(now)
          || dayjs(booking.startsAt).isBefore(now)
        ))
        .sort((a, b) => dayjs(b.startsAt).valueOf() - dayjs(a.startsAt).valueOf()),
    };
  }, [bookingsQuery.data]);

  const cancellationMutation = useMutation({
    mutationFn: cancelClientBooking,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clientQueryKeys.bookings(clientId) }),
        queryClient.invalidateQueries({ queryKey: clientQueryKeys.profile(clientId) }),
        queryClient.invalidateQueries({ queryKey: clientQueryKeys.schedules }),
      ]);
      Alert.alert(
        'Booking Cancelled',
        result.creditRefunded
          ? 'Your credit was returned automatically.'
          : 'This was a late cancellation, so the credit was not returned.'
      );
    },
    onError: (error) => Alert.alert('Cancellation Failed', error.message),
  });

  const requestCancellation = (booking: ClientBooking) => {
    const refundable = dayjs().isBefore(dayjs(booking.cancellationCutoffAt))
      || dayjs().isSame(dayjs(booking.cancellationCutoffAt));

    Alert.alert(
      'Cancel Booking?',
      refundable
        ? 'This booking is outside the cancellation window, so your credit will be returned.'
        : 'This booking is inside the cancellation window. You can cancel, but the credit will not be returned.',
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: () => cancellationMutation.mutate(booking.id),
        },
      ]
    );
  };

  const renderBooking = (booking: ClientBooking) => {
    const start = dayjs(booking.startsAt);
    const end = dayjs(booking.endsAt);
    const status = getHistoryStatus(booking);
    const statusColor = status.tone === 'success'
      ? theme.success
      : status.tone === 'warning'
        ? theme.warning
        : theme.textSecondary;
    const isCancelling = cancellationMutation.isPending && cancellationMutation.variables === booking.id;

    return (
      <View
        key={booking.id}
        style={[styles.bookingCard, { backgroundColor: theme.surface, borderColor: theme.backgroundSelected }]}
      >
        <View style={styles.dateColumn}>
          <ThemedText style={styles.monthText}>{start.format('MMM')}</ThemedText>
          <ThemedText selectable style={styles.dayText}>{start.format('D')}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.weekdayText}>{start.format('ddd')}</ThemedText>
        </View>

        <View style={styles.bookingMain}>
          <View style={styles.bookingTitleRow}>
            <ThemedText selectable numberOfLines={1} style={styles.bookingTitle}>{booking.sessionTitle}</ThemedText>
            <View style={[
              styles.servicePill,
              { backgroundColor: booking.serviceType === 'personal_training' ? theme.primary : theme.backgroundElement },
            ]}>
              <ThemedText style={[
                styles.servicePillText,
                { color: booking.serviceType === 'personal_training' ? theme.onPrimary : theme.text },
              ]}>
                {booking.serviceType === 'personal_training' ? '1-on-1 PT' : 'Group'}
              </ThemedText>
            </View>
          </View>

          <ThemedText selectable themeColor="textSecondary" style={styles.bookingMeta}>
            {start.format('h:mm A')}–{end.format('h:mm A')}{booking.coachName ? ` • ${booking.coachName}` : ''}
          </ThemedText>

          {view === 'upcoming' ? (
            <View style={styles.upcomingFooter}>
              <ThemedText selectable style={[styles.cutoffText, { color: theme.textSecondary }]}>
                Refund cutoff: {dayjs(booking.cancellationCutoffAt).format('ddd h:mm A')}
              </ThemedText>
              {booking.status === 'booked' ? (
                <Pressable
                  onPress={() => requestCancellation(booking)}
                  disabled={cancellationMutation.isPending}
                  style={[styles.cancelButton, { backgroundColor: theme.backgroundElement }]}
                >
                  {isCancelling ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <ThemedText style={[styles.cancelButtonText, { color: theme.primary }]}>Cancel</ThemedText>
                  )}
                </Pressable>
              ) : (
                <View style={[styles.statusPill, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText style={[styles.statusText, { color: theme.success }]}>Checked in</ThemedText>
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.statusPill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText selectable style={[styles.statusText, { color: statusColor }]}>{status.label}</ThemedText>
            </View>
          )}
        </View>
      </View>
    );
  };

  const visibleBookings = view === 'upcoming' ? upcoming : history;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={(
          <RefreshControl
            refreshing={bookingsQuery.isRefetching}
            onRefresh={() => bookingsQuery.refetch()}
            tintColor={theme.primary}
          />
        )}
        contentContainerStyle={styles.content}
      >
        <View style={[styles.segmentedControl, { backgroundColor: theme.backgroundElement }]}>
          {(['upcoming', 'history'] as BookingView[]).map((option) => {
            const selected = view === option;
            const count = option === 'upcoming' ? upcoming.length : history.length;
            return (
              <Pressable
                key={option}
                onPress={() => setView(option)}
                style={[
                  styles.segmentButton,
                  { backgroundColor: selected ? theme.surface : 'transparent' },
                ]}
              >
                <ThemedText style={styles.segmentText}>
                  {option === 'upcoming' ? 'Upcoming' : 'History'}
                </ThemedText>
                <View style={[styles.countBadge, { backgroundColor: selected ? theme.primary : theme.backgroundSelected }]}>
                  <ThemedText style={[styles.countText, { color: selected ? theme.onPrimary : theme.textSecondary }]}>{count}</ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>

        {bookingsQuery.isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={theme.primary} />
            <ThemedText themeColor="textSecondary">Loading bookings…</ThemedText>
          </View>
        ) : bookingsQuery.error ? (
          <View style={styles.stateBox}>
            <AppSymbol name="exclamationmark.triangle.fill" size={28} tintColor={theme.warning} />
            <ThemedText style={styles.stateTitle}>Bookings unavailable</ThemedText>
            <ThemedText selectable themeColor="textSecondary" style={styles.stateText}>{bookingsQuery.error.message}</ThemedText>
          </View>
        ) : visibleBookings.length === 0 ? (
          <View style={[styles.stateBox, styles.emptyBox, { backgroundColor: theme.surface }]}>
            <AppSymbol name={view === 'upcoming' ? 'calendar' : 'clock.arrow.circlepath'} size={30} tintColor={theme.textSecondary} />
            <ThemedText style={styles.stateTitle}>
              {view === 'upcoming' ? 'Nothing booked yet' : 'No session history'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.stateText}>
              {view === 'upcoming'
                ? 'Choose a group class or personal training slot from the Schedule tab.'
                : 'Past attendance and cancellations will appear here.'}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.bookingList}>{visibleBookings.map(renderBooking)}</View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  segmentedControl: { flexDirection: 'row', padding: 4, borderRadius: 12, borderCurve: 'continuous' },
  segmentButton: { flex: 1, minHeight: 40, borderRadius: 9, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  segmentText: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  countBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  countText: { fontSize: 11, lineHeight: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  bookingList: { gap: Spacing.two },
  bookingCard: { borderWidth: 1, borderRadius: 14, borderCurve: 'continuous', padding: 12, flexDirection: 'row', gap: 12 },
  dateColumn: { width: 44, alignItems: 'center', paddingTop: 1 },
  monthText: { fontSize: 10, lineHeight: 12, fontWeight: '900', textTransform: 'uppercase' },
  dayText: { fontSize: 23, lineHeight: 27, fontWeight: '900', fontVariant: ['tabular-nums'] },
  weekdayText: { fontSize: 10, lineHeight: 12, fontWeight: '800' },
  bookingMain: { flex: 1, minWidth: 0, gap: 5 },
  bookingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bookingTitle: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  servicePill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  servicePillText: { fontSize: 9, lineHeight: 11, fontWeight: '900', textTransform: 'uppercase' },
  bookingMeta: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  upcomingFooter: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  cutoffText: { flex: 1, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  cancelButton: { minWidth: 66, minHeight: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  cancelButtonText: { fontSize: 12, lineHeight: 15, fontWeight: '900' },
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontSize: 10, lineHeight: 13, fontWeight: '900', textTransform: 'uppercase' },
  stateBox: { minHeight: 220, padding: Spacing.four, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  emptyBox: { borderRadius: 14, borderCurve: 'continuous' },
  stateTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900', textAlign: 'center' },
  stateText: { maxWidth: 300, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
});
