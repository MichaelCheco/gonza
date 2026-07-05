import { AppSymbol } from '@/components/app-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ClientClassHistoryRecord, fetchClientClassHistory, fetchClients, gymQueryKeys } from '@/lib/gym-queries';
import { getServiceLabel, SERVICE_TYPES } from '@/utils/gym-logic';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const formatPhoneNumber = (value: string | null | undefined) => {
  const digits = (value ?? '').replace(/\D/g, '');
  const phoneDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const limitedDigits = phoneDigits.slice(0, 10);

  if (limitedDigits.length <= 3) return limitedDigits;
  if (limitedDigits.length <= 6) return `${limitedDigits.slice(0, 3)}-${limitedDigits.slice(3)}`;
  return `${limitedDigits.slice(0, 3)}-${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
};

const formatInstagramHandle = (value: string | null | undefined) => {
  const handle = (value ?? '').trim().replace(/^@+/, '');
  return handle ? `@${handle}` : '';
};

const getClientInitials = (name: string) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return initials || '?';
};

const getHistoryServiceLabel = (record: ClientClassHistoryRecord) => {
  if (record.serviceType === SERVICE_TYPES.PERSONAL_TRAINING) return getServiceLabel(SERVICE_TYPES.PERSONAL_TRAINING);
  if (record.serviceType === SERVICE_TYPES.GROUP) return getServiceLabel(SERVICE_TYPES.GROUP);
  return record.classType === 'Personal Training' ? 'PT' : 'Group';
};

export default function ClientHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const clientId = Array.isArray(params.id) ? params.id[0] : params.id;

  const {
    data: clients = [],
    error: clientsError,
    isLoading: clientsLoading,
    refetch: refetchClients,
  } = useQuery({
    queryKey: gymQueryKeys.clients,
    queryFn: fetchClients,
  });
  const {
    data: history = [],
    error: historyError,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: gymQueryKeys.clientClassHistory(clientId),
    queryFn: () => fetchClientClassHistory(clientId!),
    enabled: !!clientId,
  });

  const client = clients.find((item) => item.id.toString() === clientId) ?? null;
  const loading = clientsLoading || historyLoading;
  const error = clientsError ?? historyError;
  const contactText = client
    ? [
      formatPhoneNumber(client.phone),
      formatInstagramHandle(client.instagram_handle),
    ].filter(Boolean).join(' • ') || 'No contact added'
    : '';

  const handleRetry = () => {
    refetchClients();
    refetchHistory();
  };

  const renderHistoryItem = ({ item }: { item: ClientClassHistoryRecord }) => {
    const classDateTime = dayjs(`${item.scheduledDate}T${item.startTime}`);
    const dateLabel = classDateTime.isValid() ? classDateTime.format('MMM D, YYYY') : 'Date unavailable';
    const timeLabel = classDateTime.isValid() ? classDateTime.format('h:mm A') : '';
    const serviceLabel = getHistoryServiceLabel(item);

    return (
      <ThemedView type="surface" style={[styles.historyCard, { borderColor: theme.backgroundSelected }]}>
        <View style={styles.historyDateColumn}>
          <ThemedText style={styles.historyMonth}>{classDateTime.isValid() ? classDateTime.format('MMM') : '--'}</ThemedText>
          <ThemedText style={styles.historyDay}>{classDateTime.isValid() ? classDateTime.format('D') : '--'}</ThemedText>
        </View>

        <View style={styles.historyMain}>
          <View style={styles.historyTitleRow}>
            <ThemedText numberOfLines={1} style={styles.historyTitle}>{item.title}</ThemedText>
            <View style={[styles.servicePill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.servicePillText}>{serviceLabel}</ThemedText>
            </View>
          </View>

          <ThemedText themeColor="textSecondary" style={styles.historyMeta}>
            {[dateLabel, timeLabel, item.classType].filter(Boolean).join(' • ')}
          </ThemedText>
          <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.packageText}>
            {item.packageName}
          </ThemedText>
        </View>
      </ThemedView>
    );
  };

  const renderHeader = () => (
    <View style={styles.contentHeader}>
      <TouchableOpacity
        style={[styles.backButton, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
        onPress={() => router.back()}
        activeOpacity={0.8}
      >
        <AppSymbol name="chevron.left" size={18} tintColor={theme.text} />
      </TouchableOpacity>

      <ThemedText style={styles.headerTitle}>Class History</ThemedText>

      {client && (
        <ThemedView type="surface" style={[styles.summaryCard, { borderColor: theme.backgroundSelected }]}>
          <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
            <ThemedText style={[styles.avatarText, { color: theme.onPrimary }]}>
              {getClientInitials(client.name)}
            </ThemedText>
          </View>

          <View style={styles.summaryText}>
            <ThemedText style={styles.clientName}>{client.name}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.contactText}>{contactText}</ThemedText>
          </View>

          <View style={[styles.visitBadge, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.visitCount}>{history.length}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.visitLabel}>
              {history.length === 1 ? 'visit' : 'visits'}
            </ThemedText>
          </View>
        </ThemedView>
      )}
    </View>
  );

  const renderEmptyState = () => {
    if (loading) {
      return (
        <View style={styles.stateContainer}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText themeColor="textSecondary" style={styles.stateText}>Loading history...</ThemedText>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.stateContainer}>
          <AppSymbol name="exclamationmark.triangle.fill" size={26} tintColor={theme.primary} />
          <ThemedText style={styles.stateTitle}>History unavailable</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.stateText}>Could not load this client history.</ThemedText>
          <TouchableOpacity style={[styles.retryButton, { backgroundColor: theme.primary }]} onPress={handleRetry} activeOpacity={0.8}>
            <ThemedText style={[styles.retryButtonText, { color: theme.onPrimary }]}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      );
    }

    if (!client) {
      return (
        <View style={styles.stateContainer}>
          <ThemedText style={styles.stateTitle}>Client not found</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.stateText}>This client is no longer available.</ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.stateContainer}>
        <AppSymbol name="clock.arrow.circlepath" size={28} tintColor={theme.textSecondary} />
        <ThemedText style={styles.stateTitle}>No completed check-ins</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.stateText}>
          Completed classes will appear here after a check-in uses a package.
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={loading || error || !client ? [] : history}
          keyExtractor={(item) => item.id}
          renderItem={renderHistoryItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmptyState}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  listContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.two },
  contentHeader: { paddingTop: Spacing.two, gap: Spacing.three },
  backButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 24, lineHeight: 28, fontWeight: '900', textTransform: 'uppercase' },
  summaryCard: { borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText: { fontSize: 14, lineHeight: 17, fontWeight: '900' },
  summaryText: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  contactText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  visitBadge: { minWidth: 64, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center' },
  visitCount: { fontSize: 19, lineHeight: 23, fontWeight: '800', fontVariant: ['tabular-nums'] },
  visitLabel: { fontSize: 10, lineHeight: 12, fontWeight: '800', textTransform: 'uppercase' },
  historyCard: { borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  historyDateColumn: { width: 42, alignItems: 'center' },
  historyMonth: { fontSize: 11, lineHeight: 13, fontWeight: '900', textTransform: 'uppercase' },
  historyDay: { fontSize: 22, lineHeight: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  historyMain: { flex: 1, minWidth: 0, gap: 3 },
  historyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  historyTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  servicePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  servicePillText: { fontSize: 11, lineHeight: 13, fontWeight: '900' },
  historyMeta: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  packageText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stateContainer: { paddingVertical: Spacing.six, alignItems: 'center', gap: Spacing.two },
  stateTitle: { fontSize: 17, lineHeight: 21, fontWeight: '900', textAlign: 'center' },
  stateText: { maxWidth: 280, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  retryButton: { minHeight: 38, borderRadius: 8, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', marginTop: Spacing.one },
  retryButtonText: { fontSize: 13, lineHeight: 16, fontWeight: '900' },
});
