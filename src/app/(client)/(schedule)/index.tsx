import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Href, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  BookableSession,
  clientQueryKeys,
  fetchBookableSchedule,
  fetchClientProfile,
} from '@/lib/client-queries';
import { useAuth } from '@/providers/auth-provider';

const getBalanceLabel = (hasUnlimited: boolean, usableClasses: number, emptyLabel: string) => {
  if (hasUnlimited) return 'Unlimited';
  if (usableClasses === 1) return '1 credit';
  if (usableClasses > 1) return `${usableClasses} credits`;
  return emptyLabel;
};

export default function ClientScheduleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { clientId } = useAuth();
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => (
    Array.from({ length: 7 }, (_, index) => dayjs().add(weekOffset * 7 + index, 'day'))
  ), [weekOffset]);

  const scheduleQuery = useQuery({
    queryKey: clientQueryKeys.schedule(selectedDate),
    queryFn: () => fetchBookableSchedule(selectedDate),
  });
  const profileQuery = useQuery({
    queryKey: clientQueryKeys.profile(clientId),
    queryFn: () => fetchClientProfile(clientId!),
    enabled: !!clientId,
  });

  const sessions = scheduleQuery.data ?? [];
  const profile = profileQuery.data;
  const refreshing = scheduleQuery.isRefetching || profileQuery.isRefetching;

  const handleRefresh = () => {
    scheduleQuery.refetch();
    profileQuery.refetch();
  };

  const openConfirmation = (session: BookableSession) => {
    router.push({
      pathname: '/confirm',
      params: {
        kind: session.kind,
        id: session.id,
        date: selectedDate,
      },
    } as unknown as Href);
  };

  const changeWeek = (direction: -1 | 1) => {
    const nextOffset = Math.max(0, weekOffset + direction);
    if (nextOffset === weekOffset) return;
    setWeekOffset(nextOffset);
    setSelectedDate(dayjs().add(nextOffset * 7, 'day').format('YYYY-MM-DD'));
  };

  const renderSession = (session: BookableSession) => {
    const start = dayjs(session.startsAt);
    const end = dayjs(session.endsAt);
    const isPt = session.kind === 'personal_training';
    const spotsLabel = isPt
      ? 'Private session'
      : session.spotsRemaining === 1
        ? '1 spot left'
        : `${session.spotsRemaining} spots left`;

    return (
      <Pressable
        key={`${session.kind}-${session.id}`}
        onPress={() => openConfirmation(session)}
        style={({ pressed }) => [
          styles.sessionCard,
          {
            backgroundColor: theme.surface,
            borderColor: isPt ? theme.primary : theme.backgroundSelected,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        <View style={styles.timeColumn}>
          <ThemedText selectable style={styles.timeText}>{start.format('h:mm')}</ThemedText>
          <ThemedText selectable themeColor="textSecondary" style={styles.meridiemText}>
            {start.format('A')}
          </ThemedText>
        </View>

        <View style={styles.sessionMain}>
          <View style={styles.sessionTitleRow}>
            <ThemedText selectable numberOfLines={1} style={styles.sessionTitle}>{session.title}</ThemedText>
            <View style={[
              styles.typePill,
              { backgroundColor: isPt ? theme.primary : theme.backgroundElement },
            ]}>
              <ThemedText style={[styles.typePillText, { color: isPt ? theme.onPrimary : theme.text }]}>
                {isPt ? '1-on-1 PT' : 'Group'}
              </ThemedText>
            </View>
          </View>
          <ThemedText selectable themeColor="textSecondary" style={styles.metaText}>
            {start.format('h:mm A')}–{end.format('h:mm A')} • {session.coachName}
          </ThemedText>
          <View style={styles.statusRow}>
            <ThemedText
              selectable
              style={[
                styles.spotsText,
                { color: session.spotsRemaining === 0 ? theme.warning : theme.success },
              ]}
            >
              {spotsLabel}
            </ThemedText>
            {session.isBooked && (
              <View style={[styles.bookedPill, { backgroundColor: theme.backgroundElement }]}>
                <AppSymbol name="checkmark.circle.fill" size={13} tintColor={theme.success} />
                <ThemedText style={styles.bookedText}>Booked</ThemedText>
              </View>
            )}
          </View>
        </View>

        <AppSymbol name="chevron.right" size={15} tintColor={theme.textSecondary} />
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
        contentContainerStyle={styles.content}
      >
        <View style={styles.weekNavigator}>
          <Pressable
            onPress={() => changeWeek(-1)}
            disabled={weekOffset === 0}
            style={[styles.weekArrow, { backgroundColor: theme.backgroundElement, opacity: weekOffset === 0 ? 0.35 : 1 }]}
          >
            <AppSymbol name="chevron.left" size={16} tintColor={theme.text} />
          </Pressable>
          <ThemedText selectable style={styles.weekLabel}>
            {weekOffset === 0
              ? 'Next 7 days'
              : `${weekDays[0].format('MMM D')}–${weekDays[6].format('MMM D')}`}
          </ThemedText>
          <Pressable
            onPress={() => changeWeek(1)}
            style={[styles.weekArrow, { backgroundColor: theme.backgroundElement }]}
          >
            <AppSymbol name="chevron.right" size={16} tintColor={theme.text} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {weekDays.map((date) => {
            const dateKey = date.format('YYYY-MM-DD');
            const selected = dateKey === selectedDate;

            return (
              <Pressable
                key={dateKey}
                onPress={() => setSelectedDate(dateKey)}
                style={[
                  styles.dayButton,
                  { backgroundColor: selected ? theme.primary : theme.backgroundElement },
                ]}
              >
                <ThemedText style={[styles.dayName, { color: selected ? theme.onPrimary : theme.textSecondary }]}>
                  {date.format('dd').slice(0, 1)}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.dayNumber,
                    { color: selected ? theme.onPrimary : theme.text },
                  ]}
                >
                  {date.format('D')}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.balanceCard, { backgroundColor: theme.surface, borderColor: theme.backgroundSelected }]}>
          <View style={styles.balanceItem}>
            <ThemedText themeColor="textSecondary" style={styles.balanceLabel}>Group pass</ThemedText>
            <ThemedText selectable style={styles.balanceValue}>
              {profile
                ? getBalanceLabel(profile.groupSummary.hasUnlimited, profile.groupSummary.usableClasses, 'No credits')
                : '—'}
            </ThemedText>
          </View>
          <View style={[styles.balanceDivider, { backgroundColor: theme.backgroundSelected }]} />
          <View style={styles.balanceItem}>
            <ThemedText themeColor="textSecondary" style={styles.balanceLabel}>1-on-1 PT</ThemedText>
            <ThemedText selectable style={styles.balanceValue}>
              {profile
                ? getBalanceLabel(profile.ptSummary.hasUnlimited, profile.ptSummary.usableClasses, 'No credits')
                : '—'}
            </ThemedText>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <ThemedText style={styles.dateTitle}>{dayjs(selectedDate).format('dddd, MMMM D')}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.sectionHint}>Classes and PT availability</ThemedText>
        </View>

        {scheduleQuery.isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={theme.primary} />
            <ThemedText themeColor="textSecondary">Loading schedule…</ThemedText>
          </View>
        ) : scheduleQuery.error ? (
          <View style={styles.stateBox}>
            <AppSymbol name="exclamationmark.triangle.fill" size={26} tintColor={theme.warning} />
            <ThemedText style={styles.stateTitle}>Schedule unavailable</ThemedText>
            <ThemedText selectable themeColor="textSecondary" style={styles.stateText}>
              {scheduleQuery.error.message}
            </ThemedText>
            <Pressable style={[styles.retryButton, { backgroundColor: theme.primary }]} onPress={() => scheduleQuery.refetch()}>
              <ThemedText style={{ color: theme.onPrimary, fontWeight: '800' }}>Try Again</ThemedText>
            </Pressable>
          </View>
        ) : sessions.length === 0 ? (
          <View style={[styles.stateBox, styles.emptyBox, { backgroundColor: theme.surface }]}>
            <AppSymbol name="calendar" size={30} tintColor={theme.textSecondary} />
            <ThemedText style={styles.stateTitle}>No sessions available</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.stateText}>
              Check another day for group classes or personal training openings.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.sessionList}>{sessions.map(renderSession)}</View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  weekNavigator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.two },
  weekArrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  weekRow: { flexDirection: 'row', gap: 6 },
  dayButton: { flex: 1, minHeight: 54, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 1 },
  dayName: { fontSize: 11, lineHeight: 13, fontWeight: '800', textTransform: 'uppercase' },
  dayNumber: { fontSize: 18, lineHeight: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  balanceCard: { borderWidth: 1, borderRadius: 14, borderCurve: 'continuous', padding: 14, flexDirection: 'row', alignItems: 'center' },
  balanceItem: { flex: 1, gap: 2 },
  balanceDivider: { width: 1, height: 36, marginHorizontal: Spacing.three },
  balanceLabel: { fontSize: 11, lineHeight: 14, fontWeight: '800', textTransform: 'uppercase' },
  balanceValue: { fontSize: 17, lineHeight: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sectionHeader: { gap: 2, paddingTop: Spacing.one },
  dateTitle: { fontSize: 20, lineHeight: 24, fontWeight: '900' },
  sectionHint: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  sessionList: { gap: Spacing.two },
  sessionCard: { minHeight: 96, borderWidth: 1, borderRadius: 14, borderCurve: 'continuous', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeColumn: { width: 46, alignItems: 'center' },
  timeText: { fontSize: 18, lineHeight: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  meridiemText: { fontSize: 10, lineHeight: 12, fontWeight: '800' },
  sessionMain: { flex: 1, minWidth: 0, gap: 4 },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sessionTitle: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  typePill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  typePillText: { fontSize: 10, lineHeight: 12, fontWeight: '900', textTransform: 'uppercase' },
  metaText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spotsText: { fontSize: 11, lineHeight: 14, fontWeight: '800' },
  bookedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  bookedText: { fontSize: 10, lineHeight: 13, fontWeight: '900' },
  stateBox: { minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  emptyBox: { borderRadius: 14, borderCurve: 'continuous' },
  stateTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900', textAlign: 'center' },
  stateText: { maxWidth: 300, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  retryButton: { minHeight: 40, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
});
