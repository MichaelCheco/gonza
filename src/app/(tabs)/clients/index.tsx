import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  calculateExpirationDateFromPackage,
  ClientPackageRow,
  getClientPackageStatus,
  getServiceLabel,
  hasClientReceivedIntroPromo,
  isClientPackageUnpaid,
  isFirstClassFreePackage,
  isIntroPromoPackage,
  isUnlimitedPackage,
  PackageRow,
  SERVICE_TYPES,
  ServiceSummary,
} from '@/utils/gym-logic';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import dayjs from 'dayjs';
import * as Clipboard from 'expo-clipboard';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { AppSymbol } from '@/components/app-symbol';
import { ClientRecord, fetchClients, fetchPackages, gymQueryKeys } from '@/lib/gym-queries';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/utils/supabase';

const SERVICE_ORDER = [SERVICE_TYPES.GROUP, SERVICE_TYPES.PERSONAL_TRAINING];
type ClientFilter = 'all' | 'attention';

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

const normalizeInstagramHandle = (value: string | null | undefined) => (
  formatInstagramHandle(value).replace(/^@/, '') || null
);

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

export default function ClientsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ClientFilter>('all');

  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [adjustingPackageId, setAdjustingPackageId] = useState<number | null>(null);
  const [adjustedCredits, setAdjustedCredits] = useState('');
  const [savingPackageActionId, setSavingPackageActionId] = useState<number | null>(null);
  const [addingPackageId, setAddingPackageId] = useState<number | null>(null);

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);
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
    data: packages = [],
    error: packagesError,
    isLoading: packagesLoading,
    refetch: refetchPackages,
  } = useQuery({
    queryKey: gymQueryKeys.packages,
    queryFn: fetchPackages,
  });
  const loading = clientsLoading || packagesLoading;
  const editingClient = useMemo(() => {
    if (!editingClientId) return null;
    return clients.find((client) => client.id === editingClientId) ?? null;
  }, [clients, editingClientId]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
    []
  );
  const bottomSheetKeyboardProps = useMemo(() => ({
    android_keyboardInputMode: 'adjustResize' as const,
    enableBlurKeyboardOnGesture: true,
    enableDynamicSizing: false,
    keyboardBehavior: 'interactive' as const,
    keyboardBlurBehavior: 'restore' as const,
  }), []);

  useEffect(() => {
    if (clientsError) {
      console.error('Clients Fetch Error:', clientsError);
      Alert.alert('Clients Error', clientsError.message);
    }
  }, [clientsError]);

  useEffect(() => {
    if (packagesError) {
      console.error('Packages Fetch Error:', packagesError);
      Alert.alert('Packages Error', packagesError.message);
    }
  }, [packagesError]);

  useEffect(() => {
    if (!phoneCopied) return;

    const timeout = setTimeout(() => setPhoneCopied(false), 1400);
    return () => clearTimeout(timeout);
  }, [phoneCopied]);

  useFocusEffect(
    useCallback(() => {
      refetchClients();
      refetchPackages();
    }, [refetchClients, refetchPackages])
  );

  const getClientAttention = useCallback((client: ClientRecord) => {
    const hasUnpaid = client.client_packages.some(isClientPackageUnpaid);
    const hasUsableCredits = client.packageSummaries.some((summary) => summary.hasUnlimited || summary.usableClasses > 0);
    const hasPackageHistory = client.client_packages.length > 0;

    if (hasUnpaid) return { active: false, reason: 'Unpaid balance', type: 'unpaid' as const };
    if (!hasUsableCredits) return { active: false, reason: hasPackageHistory ? 'No usable credits' : 'No packages', type: 'noCredits' as const };

    return { active: true, reason: 'Good to go', type: 'good' as const };
  }, []);

  const clientMetrics = useMemo(() => {
    return clients.reduce(
      (acc, client) => {
        const attention = getClientAttention(client);
        acc.total += 1;
        if (!attention.active) acc.attention += 1;
        return acc;
      },
      { total: 0, attention: 0 }
    );
  }, [clients, getClientAttention]);

  const filteredClients = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return clients.filter((client) => {
      const matchesSearch = !normalizedQuery || client.name.toLowerCase().includes(normalizedQuery);
      const attention = getClientAttention(client);

      if (!matchesSearch) return false;
      if (activeFilter === 'attention') return !attention.active;

      return true;
    });
  }, [activeFilter, searchQuery, clients, getClientAttention]);

  const availablePackages = useMemo(() => {
    if (!editingClient) return packages;

    return packages.filter((pkg) => (
      !isIntroPromoPackage(pkg) ||
      !hasClientReceivedIntroPromo(editingClient.client_packages, pkg)
    ));
  }, [editingClient, packages]);
  const packagesByService = useMemo(() => {
    return SERVICE_ORDER.map((serviceType) => ({
      serviceType,
      label: getServiceLabel(serviceType),
      packages: availablePackages.filter((pkg) => pkg.service_type === serviceType),
    }));
  }, [availablePackages]);

  const selectedPackage = useMemo(() => {
    return availablePackages.find((pkg) => pkg.id === selectedPackageId) ?? availablePackages[0] ?? null;
  }, [availablePackages, selectedPackageId]);
  const unpaidClientPackages = useMemo(() => {
    return editingClient?.client_packages.filter(isClientPackageUnpaid) ?? [];
  }, [editingClient]);

  const getVisiblePackageSummaries = (client: ClientRecord) => {
    return client.packageSummaries.filter((summary) => {
      if (summary.serviceType === SERVICE_TYPES.PERSONAL_TRAINING) return summary.totalCount > 0;
      return true;
    });
  };

  const buildClientPackageInsert = (clientId: number, pkg: PackageRow) => {
    const startDate = dayjs().format('YYYY-MM-DD');

    return {
      client_id: clientId,
      package_id: pkg.id,
      classes_remaining: isUnlimitedPackage(pkg) ? null : pkg.total_classes,
      start_date: startDate,
      expiration_date: calculateExpirationDateFromPackage(pkg, startDate),
      payment_status: isFirstClassFreePackage(pkg) ? 'paid' : 'unpaid',
    };
  };

  const handleAddClient = () => {
    setEditingClientId(null);
    setFullName('');
    setPhone('');
    setInstagramHandle('');
    setPhoneCopied(false);
    setAdjustingPackageId(null);
    setAdjustedCredits('');
    setSavingPackageActionId(null);
    setAddingPackageId(null);
    setSelectedPackageId(packages[0]?.id ?? null);
    bottomSheetModalRef.current?.present();
  };

  const handleClientPress = (client: ClientRecord) => {
    setEditingClientId(client.id);
    setFullName(client.name);
    setPhone(formatPhoneNumber(client.phone));
    setInstagramHandle(formatInstagramHandle(client.instagram_handle));
    setPhoneCopied(false);
    setAdjustingPackageId(null);
    setAdjustedCredits('');
    setSavingPackageActionId(null);
    setAddingPackageId(null);
    setSelectedPackageId(packages[0]?.id ?? null);
    bottomSheetModalRef.current?.present();
  };

  const closeBottomSheet = () => bottomSheetModalRef.current?.dismiss();

  const handleViewClassHistory = () => {
    if (!editingClient) return;

    closeBottomSheet();
    router.push(`/clients/${editingClient.id}` as Href);
  };

  const refreshClients = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: gymQueryKeys.clients });
  }, [queryClient]);

  const handlePhoneChange = (value: string) => {
    setPhone(formatPhoneNumber(value));
    if (phoneCopied) setPhoneCopied(false);
  };

  const handleInstagramChange = (value: string) => {
    setInstagramHandle(value.trim() === '@' ? '@' : formatInstagramHandle(value));
  };

  const handleCopyPhone = async () => {
    const formattedPhone = formatPhoneNumber(phone);
    if (!formattedPhone) return;

    await Clipboard.setStringAsync(formattedPhone);
    setPhoneCopied(true);
  };

  const handleAddPackage = async (packageOverride?: PackageRow) => {
    const packageToAdd = packageOverride ?? selectedPackage;
    if (!editingClient || !packageToAdd) return;
    if (addingPackageId !== null) return;

    if (isIntroPromoPackage(packageToAdd) && hasClientReceivedIntroPromo(editingClient.client_packages, packageToAdd)) {
      Alert.alert('Promo Already Used', `${packageToAdd.name} can only be used once per client.`);
      return;
    }

    setAddingPackageId(packageToAdd.id);
    const { error } = await supabase.from('client_packages').insert(buildClientPackageInsert(editingClient.id, packageToAdd));
    setAddingPackageId(null);

    if (error) Alert.alert('Database Error', error.message);
    else refreshClients();
  };

  const handleMarkPaid = async (clientPackage: ClientPackageRow) => {
    if (!editingClient) return;
    if (!isClientPackageUnpaid(clientPackage)) return;

    setSavingPackageActionId(clientPackage.id);

    const { error } = await supabase
      .from('client_packages')
      .update({ payment_status: 'paid' })
      .eq('id', clientPackage.id)
      .select('id')
      .single();

    setSavingPackageActionId(null);

    if (error) {
      Alert.alert('Update Failed', 'Could not mark this package paid. Please try again.');
      return;
    }

    refreshClients();
  };

  const handleVoidPackage = (clientPackage: ClientPackageRow) => {
    if (!editingClient) return;

    Alert.alert('Remove Package', 'Remove this unpaid, unused package from active balances? It will stay in history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('client_packages')
            .update({ payment_status: 'voided', classes_remaining: 0 })
            .eq('id', clientPackage.id);

          if (error) Alert.alert('Remove Failed', 'Could not remove this package. Please try again.');
          else refreshClients();
        },
      },
    ]);
  };

  const handleAdjustPackageCredits = (clientPackage: ClientPackageRow) => {
    setAdjustingPackageId(clientPackage.id);
    setAdjustedCredits(String(clientPackage.classes_remaining));
  };

  const handleCancelPackageAdjustment = () => {
    setAdjustingPackageId(null);
    setAdjustedCredits('');
  };

  const handleSavePackageAdjustment = async (clientPackage: ClientPackageRow) => {
    if (!editingClient) return;

    const nextCredits = Number.parseInt(adjustedCredits.trim(), 10);

    if (!Number.isFinite(nextCredits) || nextCredits < 0) {
      Alert.alert('Invalid Credits', 'Enter a whole number of 0 or more.');
      return;
    }

    setSavingPackageActionId(clientPackage.id);

    const { error } = await supabase
      .from('client_packages')
      .update({ classes_remaining: nextCredits })
      .eq('id', clientPackage.id)
      .select('id')
      .single();

    setSavingPackageActionId(null);

    if (error) {
      Alert.alert('Adjustment Failed', 'Could not update credits. Please try again.');
      return;
    }

    handleCancelPackageAdjustment();
    refreshClients();
  };

  const handleSave = async () => {
    const trimmedName = fullName.trim();
    if (!trimmedName) return Alert.alert('Error', 'Please enter a name.');
    const formattedPhone = formatPhoneNumber(phone);
    const normalizedInstagramHandle = normalizeInstagramHandle(instagramHandle);

    const [firstName, ...lastNameArr] = trimmedName.split(/\s+/);
    const lastName = lastNameArr.join(' ');

    if (editingClient) {
      const { error } = await supabase
        .from('clients')
        .update({ first_name: firstName, last_name: lastName, phone: formattedPhone || null, instagram_handle: normalizedInstagramHandle })
        .eq('id', editingClient.id);

      if (error) Alert.alert('Error', error.message);
      else {
        await refreshClients();
        closeBottomSheet();
      }

      return;
    }

    if (!selectedPackage) return Alert.alert('Error', 'Please select a package.');

    const { data: newClient, error: clientErr } = await supabase
      .from('clients')
      .insert({ first_name: firstName, last_name: lastName, phone: formattedPhone || null, instagram_handle: normalizedInstagramHandle })
      .select()
      .single();

    if (clientErr) return Alert.alert('Error', clientErr.message);

    const { error: pkgErr } = await supabase
      .from('client_packages')
      .insert(buildClientPackageInsert(newClient.id, selectedPackage));

    if (pkgErr) Alert.alert('Error', pkgErr.message);
    else {
      await refreshClients();
      closeBottomSheet();
    }
  };

  const getStatusPalette = (summary: ServiceSummary) => {
    const hasPackage = summary.totalCount > 0;
    const isUnpaid = summary.unpaidCount > 0;
    const isEmpty = !summary.hasUnlimited && (!hasPackage || summary.usableClasses === 0);

    if (isUnpaid) {
      return {
        background: theme.background,
        border: theme.warning,
        text: theme.text,
        muted: theme.textSecondary,
        icon: 'exclamationmark.triangle.fill' as const,
      };
    }

    if (isEmpty) {
      return {
        background: theme.background,
        border: theme.primary,
        text: theme.text,
        muted: theme.textSecondary,
        icon: 'exclamationmark.triangle.fill' as const,
      };
    }

    return {
      background: theme.background,
      border: theme.backgroundSelected,
      text: theme.text,
      muted: theme.textSecondary,
      icon: null,
    };
  };

  const getClientStateChip = (attention: ReturnType<typeof getClientAttention>) => {
    if (attention.type === 'unpaid') {
      return {
        label: 'Unpaid balance',
        icon: 'exclamationmark.triangle.fill' as const,
        color: theme.warning,
      };
    }

    if (attention.type === 'noCredits') {
      return {
        label: attention.reason === 'No packages' ? 'No packages' : 'No credits',
        icon: 'exclamationmark.triangle.fill' as const,
        color: theme.primary,
      };
    }

    return {
      label: 'Good to go',
      icon: 'checkmark.circle.fill' as const,
      color: theme.success,
    };
  };

  const getServiceBalanceLabel = (summary: ServiceSummary) => {
    if (summary.hasUnlimited) return `${summary.label}: unlimited`;
    if (summary.totalCount === 0) return `${summary.label}: none`;
    if (summary.usableClasses > 0) return `${summary.label}: ${summary.usableClasses} left`;
    return `${summary.label}: 0 usable`;
  };

  const getServiceBalanceSummary = (client: ClientRecord) => (
    getVisiblePackageSummaries(client).map(getServiceBalanceLabel).join(' · ')
  );

  const renderServiceTile = (summary: ServiceSummary) => {
    const hasPackage = summary.totalCount > 0;
    const palette = getStatusPalette(summary);
    const value = summary.hasUnlimited ? 'Unlimited' : hasPackage ? (summary.usableClasses > 0 ? `${summary.usableClasses}` : summary.reason) : 'None';
    const caption = summary.hasUnlimited ? summary.label : hasPackage && summary.usableClasses > 0 ? 'left' : summary.label;

    return (
      <View key={summary.serviceType} style={styles.serviceTile}>
        <View style={[styles.serviceTileAccent, { backgroundColor: palette.border }]} />
        <View style={styles.serviceTileHeader}>
          <ThemedText style={[styles.serviceTileLabel, { color: palette.text }]}>{summary.label}</ThemedText>
          {summary.needsAttention && palette.icon && <AppSymbol name={palette.icon} size={13} tintColor={palette.border} />}
        </View>
        <View style={styles.serviceTileValueRow}>
          <ThemedText style={[styles.serviceTileValue, { color: palette.text }]}>{value}</ThemedText>
          <ThemedText style={[styles.serviceTileCaption, { color: palette.muted }]}>{caption}</ThemedText>
        </View>
      </View>
    );
  };

  const renderUnpaidPackageAction = (clientPackage: ClientPackageRow) => {
    const pkg = clientPackage.packages;
    const isSaving = savingPackageActionId === clientPackage.id;
    const serviceLabel = pkg ? getServiceLabel(pkg.service_type) : 'Package';
    const creditLabel = isUnlimitedPackage(pkg) ? 'Unlimited classes' : `${clientPackage.classes_remaining ?? 0} credits`;

    return (
      <View key={clientPackage.id} style={[styles.unpaidActionRow, { backgroundColor: theme.background, borderColor: theme.surface }]}>
        <View style={styles.unpaidActionMain}>
          <View style={styles.unpaidActionTitleRow}>
            <ThemedText numberOfLines={1} style={styles.unpaidActionTitle}>{pkg?.name ?? 'Unknown Package'}</ThemedText>
            <View style={[styles.historyServicePill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.historyServiceText}>{serviceLabel}</ThemedText>
            </View>
          </View>
          <ThemedText themeColor="textSecondary" style={styles.unpaidActionMeta}>
            {creditLabel} waiting for payment
          </ThemedText>
        </View>

        <TouchableOpacity
          style={[styles.quickMarkPaidButton, { backgroundColor: theme.success, borderColor: theme.success }]}
          onPress={() => handleMarkPaid(clientPackage)}
          disabled={isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.onSuccess} />
          ) : (
            <>
              <AppSymbol name="checkmark" size={15} tintColor={theme.onSuccess} />
              <ThemedText style={[styles.quickMarkPaidText, { color: theme.onSuccess }]}>Mark Paid</ThemedText>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderPackageHistoryRow = (clientPackage: ClientPackageRow) => {
    const status = getClientPackageStatus(clientPackage);
    const pkg = clientPackage.packages;
    const isUnlimited = isUnlimitedPackage(pkg);
    const isUnpaid = isClientPackageUnpaid(clientPackage);
    const isVoided = clientPackage.payment_status === 'voided';
    const canVoid = isUnpaid && !!pkg && (isUnlimited ? clientPackage.classes_remaining === null : clientPackage.classes_remaining === pkg.total_classes);
    const canAdjust = !isUnlimited && status.active && clientPackage.payment_status === 'paid';
    const isAdjusting = adjustingPackageId === clientPackage.id;
    const isSaving = savingPackageActionId === clientPackage.id;
    const serviceLabel = pkg ? getServiceLabel(pkg.service_type) : 'Package';
    const expirationText = clientPackage.expiration_date
      ? `Expires ${dayjs(clientPackage.expiration_date).format('MMM D, YYYY')}`
      : 'No expiration';
    const packageBalanceText = isUnlimited ? 'Unlimited classes' : `${clientPackage.classes_remaining ?? 0} left`;

    return (
      <View key={clientPackage.id} style={[styles.historyCard, { borderColor: theme.surface, backgroundColor: theme.background }]}>
        <View style={styles.historyRow}>
          <View style={styles.historyMain}>
            <View style={styles.historyTitleRow}>
              <ThemedText style={styles.historyTitle}>{pkg?.name ?? 'Unknown Package'}</ThemedText>
              <View style={[styles.historyServicePill, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.historyServiceText}>{serviceLabel}</ThemedText>
              </View>
            </View>
            <ThemedText themeColor="textSecondary" style={styles.historyMeta}>
              {packageBalanceText} • {expirationText}
            </ThemedText>
            <ThemedText style={[styles.historyStatus, { color: isVoided ? theme.textSecondary : status.active ? theme.success : theme.primary }]}>
              {status.reason}
            </ThemedText>
          </View>

          <View style={styles.historyActionColumn}>
            <View style={[styles.remainingBadge, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.remainingValue}>{isUnlimited ? 'All' : clientPackage.classes_remaining ?? 0}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.remainingLabel}>{isUnlimited ? 'classes' : 'left'}</ThemedText>
            </View>

            {canAdjust && (
              <TouchableOpacity
                style={[styles.historySmallButton, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}
                onPress={() => handleAdjustPackageCredits(clientPackage)}
                activeOpacity={0.8}
                disabled={isSaving}
              >
                <AppSymbol name="slider.horizontal.3" size={14} tintColor={theme.textSecondary} />
                <ThemedText style={[styles.historySmallButtonText, { color: theme.textSecondary }]}>Adjust</ThemedText>
              </TouchableOpacity>
            )}

            {isUnpaid ? (
              <TouchableOpacity
                style={[styles.markPaidButton, { backgroundColor: theme.success, borderColor: theme.success }]}
                onPress={() => handleMarkPaid(clientPackage)}
                disabled={isSaving}
                activeOpacity={0.8}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={theme.onSuccess} />
                ) : (
                  <>
                    <AppSymbol name="checkmark" size={15} tintColor={theme.onSuccess} />
                    <ThemedText style={[styles.markPaidText, { color: theme.onSuccess }]}>Mark Paid</ThemedText>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View style={[styles.historyStatusPill, { backgroundColor: theme.control, borderColor: theme.surface }]}>
                <ThemedText style={[styles.historyStatusPillText, { color: theme.textSecondary }]}>
                  {isVoided ? 'Removed' : 'Paid'}
                </ThemedText>
              </View>
            )}

            {canVoid && (
              <TouchableOpacity
                style={[styles.historySmallButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
                onPress={() => handleVoidPackage(clientPackage)}
                activeOpacity={0.8}
                disabled={isSaving}
              >
                <AppSymbol name="xmark.circle.fill" size={14} tintColor={theme.primary} />
                <ThemedText style={[styles.historySmallButtonText, { color: theme.primary }]}>Remove</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isAdjusting && (
          <View style={[styles.adjustCreditsPanel, { borderTopColor: theme.surface }]}>
            <View style={styles.adjustCreditsInputColumn}>
              <ThemedText themeColor="textSecondary" style={styles.adjustCreditsLabel}>Credits remaining</ThemedText>
              <BottomSheetTextInput
                style={[styles.adjustCreditsInput, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.backgroundElement }]}
                value={adjustedCredits}
                onChangeText={setAdjustedCredits}
                keyboardType="number-pad"
                selectTextOnFocus
              />
            </View>
            <TouchableOpacity
              style={[styles.adjustCreditsButton, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}
              onPress={handleCancelPackageAdjustment}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.adjustCreditsButtonText, { color: theme.textSecondary }]}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustCreditsButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => handleSavePackageAdjustment(clientPackage)}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <ThemedText style={[styles.adjustCreditsButtonText, { color: theme.onPrimary }]}>Save</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderFilterChip = (filter: ClientFilter, label: string, count: number) => {
    const isSelected = activeFilter === filter;

    return (
      <TouchableOpacity
        key={filter}
        style={[
          styles.filterChip,
          {
            backgroundColor: isSelected ? theme.controlSelected : theme.control,
            borderColor: isSelected ? theme.controlSelected : theme.backgroundSelected,
          },
        ]}
        onPress={() => setActiveFilter(filter)}
        activeOpacity={0.8}
      >
        <ThemedText style={[styles.filterChipText, { color: isSelected ? theme.onControlSelected : theme.text }]}>
          {label} ({count})
        </ThemedText>
      </TouchableOpacity>
    );
  };

  const renderPackageOption = (pkg: PackageRow) => {
    const isSelected = !editingClient && selectedPackage?.id === pkg.id;
    const isAdding = addingPackageId === pkg.id;
    const classText = isUnlimitedPackage(pkg) ? 'Unlimited classes' : `${pkg.total_classes ?? 0} credits`;
    const expirationText = pkg.expires_in_weeks ? `${pkg.expires_in_weeks} weeks` : 'No expiration';

    return (
      <TouchableOpacity
        key={pkg.id.toString()}
        style={[
          styles.packageOption,
          {
            backgroundColor: isSelected ? theme.backgroundSelected : theme.background,
            borderColor: isSelected ? theme.controlSelected : theme.surface,
          },
        ]}
        onPress={() => editingClient ? handleAddPackage(pkg) : setSelectedPackageId(pkg.id)}
        activeOpacity={0.8}
        disabled={addingPackageId !== null}
      >
        <View style={styles.packageOptionMain}>
          <ThemedText style={styles.packageOptionTitle}>{pkg.name}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.packageOptionMeta}>
            {classText} • {expirationText}
          </ThemedText>
        </View>

        {editingClient ? (
          <View style={[styles.inlineAddButton, { backgroundColor: theme.controlSelected }]}>
            {isAdding ? (
              <ActivityIndicator size="small" color={theme.onControlSelected} />
            ) : (
              <AppSymbol name="plus" size={14} tintColor={theme.onControlSelected} weight="bold" />
            )}
          </View>
        ) : (
          <View style={[styles.radioMark, { borderColor: isSelected ? theme.controlSelected : theme.textSecondary }]}>
            {isSelected && <View style={[styles.radioMarkInner, { backgroundColor: theme.controlSelected }]} />}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderClientCard = ({ item }: { item: ClientRecord }) => {
    const attention = getClientAttention(item);
    const clientStateChip = getClientStateChip(attention);
    const serviceBalanceSummary = getServiceBalanceSummary(item);

    return (
      <TouchableOpacity activeOpacity={0.8} onPress={() => handleClientPress(item)}>
        <ThemedView type="surface" style={styles.clientCard}>
          <View style={styles.clientCardBody}>
            <View style={[styles.clientAvatar, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
              <ThemedText style={[styles.clientAvatarText, { color: theme.textSecondary }]}>
                {getClientInitials(item.name)}
              </ThemedText>
            </View>

            <View style={styles.clientCardContent}>
              <View style={styles.clientCardHeader}>
                <View style={styles.clientIdentity}>
                  <ThemedText numberOfLines={1} style={styles.clientName}>{item.name}</ThemedText>
                  <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.clientPhone}>
                    {formatInstagramHandle(item.instagram_handle) || formatPhoneNumber(item.phone) || 'No contact added'}
                  </ThemedText>
                </View>

                <View style={styles.clientAffordance}>
                  <View style={[styles.clientStatePill, { backgroundColor: theme.backgroundElement, borderColor: clientStateChip.color }]}>
                    <AppSymbol name={clientStateChip.icon} size={12} tintColor={clientStateChip.color} />
                    <ThemedText numberOfLines={1} style={[styles.clientStatePillText, { color: clientStateChip.color }]}>
                      {clientStateChip.label}
                    </ThemedText>
                  </View>
                  <AppSymbol name="chevron.right" size={15} tintColor={theme.textSecondary} />
                </View>
              </View>

              <ThemedText numberOfLines={2} themeColor="textSecondary" style={styles.serviceBalanceText}>
                {serviceBalanceSummary}
              </ThemedText>
            </View>
          </View>
        </ThemedView>
      </TouchableOpacity>
    );
  };

  const renderLoadingSkeleton = () => (
    <View style={styles.skeletonList}>
      {[0, 1, 2].map((item) => (
        <ThemedView key={item} type="surface" style={styles.skeletonCard}>
          <View style={styles.skeletonHeaderRow}>
            <View style={[styles.skeletonAvatar, { backgroundColor: theme.backgroundElement }]} />
            <View style={styles.skeletonMetaRow}>
              <View style={styles.skeletonTitleRow}>
                <View style={[styles.skeletonLineLarge, { backgroundColor: theme.backgroundElement }]} />
                <View style={[styles.skeletonBadge, { backgroundColor: theme.backgroundElement }]} />
              </View>
              <View style={[styles.skeletonLineSmall, { backgroundColor: theme.backgroundElement }]} />
              <View style={styles.skeletonStatusRow}>
                <View style={[styles.skeletonStatusLine, { backgroundColor: theme.backgroundElement }]} />
              </View>
            </View>
          </View>
        </ThemedView>
      ))}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <ThemedText style={styles.headerTitle}>Clients</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.headerMeta}>
              {clientMetrics.total} clients • {clientMetrics.attention} need attention
            </ThemedText>
          </View>
        </View>

        <View style={[styles.searchContainer, { backgroundColor: theme.backgroundElement }]}>
          <AppSymbol name="magnifyingglass" size={18} tintColor={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search clients..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
        </View>

        <View style={styles.filterBar}>
          {renderFilterChip('all', 'All', clientMetrics.total)}
          {renderFilterChip('attention', 'Needs Attention', clientMetrics.attention)}
        </View>

        <FlatList
          data={loading ? [] : filteredClients}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderClientCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? (
              renderLoadingSkeleton()
            ) : (
              <ThemedText themeColor="textSecondary" style={styles.emptyText}>No clients found.</ThemedText>
            )
          }
        />

        <TouchableOpacity style={[styles.fab, { backgroundColor: theme.primary }]} activeOpacity={0.8} onPress={handleAddClient}>
          <AppSymbol name="person.badge.plus" size={22} tintColor={theme.onPrimary} />
        </TouchableOpacity>
      </SafeAreaView>

      <BottomSheetModal
        ref={bottomSheetModalRef}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.backgroundElement }}
        handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}
        {...bottomSheetKeyboardProps}
      >
        <BottomSheetScrollView
          style={styles.sheetScroll}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sheetScrollContent}
        >
            <ThemedText style={styles.sheetTitle}>{editingClient ? 'Client Details' : 'New Client'}</ThemedText>

            {editingClient && (
              <View style={[styles.sheetSummary, { backgroundColor: theme.background, borderColor: theme.surface }]}>
                <View style={styles.sheetSummaryHeader}>
                  <View style={styles.sheetSummaryAvatar}>
                    <ThemedText style={[styles.sheetSummaryInitials, { color: theme.onPrimary }]}>
                      {getClientInitials(editingClient.name)}
                    </ThemedText>
                  </View>
                  <View style={styles.sheetSummaryText}>
                    <ThemedText style={styles.sheetSummaryName}>{editingClient.name}</ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.sheetSummaryMeta}>
                      {[
                        formatPhoneNumber(editingClient.phone),
                        formatInstagramHandle(editingClient.instagram_handle),
                      ].filter(Boolean).join(' • ') || 'No contact added'}
                    </ThemedText>
                  </View>
                </View>

                {!getClientAttention(editingClient).active && (
                  <View style={styles.sheetSummaryStatusRow}>
                    <View style={[styles.statusPill, { backgroundColor: theme.backgroundElement, borderColor: theme.primary }]}>
                      <AppSymbol name="exclamationmark.triangle.fill" size={14} tintColor={theme.primary} />
                      <ThemedText style={[styles.statusPillText, { color: theme.primary }]}>
                        {getClientAttention(editingClient).reason}
                      </ThemedText>
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.historyLinkButton, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}
                  onPress={handleViewClassHistory}
                  activeOpacity={0.8}
                >
                  <View style={styles.historyLinkLabel}>
                    <AppSymbol name="clock.arrow.circlepath" size={17} tintColor={theme.text} />
                    <ThemedText style={styles.historyLinkText}>Class History</ThemedText>
                  </View>
                  <AppSymbol name="chevron.right" size={15} tintColor={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            )}

            <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Name</ThemedText>
            <BottomSheetTextInput
              style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
              value={fullName}
              onChangeText={setFullName}
              placeholderTextColor={theme.textSecondary}
            />

            <View style={styles.inputLabelRow}>
              <ThemedText themeColor="textSecondary" style={[styles.inputLabel, styles.inputLabelInline]}>Phone Number</ThemedText>
              {!!formatPhoneNumber(phone) && (
                <TouchableOpacity
                  style={[styles.copyPhoneButton, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}
                  onPress={handleCopyPhone}
                  activeOpacity={0.8}
                >
                  <AppSymbol name={phoneCopied ? 'checkmark' : 'doc.on.doc'} size={13} tintColor={phoneCopied ? theme.success : theme.textSecondary} />
                  <ThemedText style={[styles.copyPhoneText, { color: phoneCopied ? theme.success : theme.textSecondary }]}>
                    {phoneCopied ? 'Copied' : 'Copy'}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <BottomSheetTextInput
              style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
              value={phone}
              onChangeText={handlePhoneChange}
              keyboardType="phone-pad"
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Instagram Handle</ThemedText>
            <BottomSheetTextInput
              style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
              value={instagramHandle}
              onChangeText={handleInstagramChange}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="@username"
              placeholderTextColor={theme.textSecondary}
            />

            {editingClient && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionSubtitle}>Balances</ThemedText>
                <View style={[styles.balanceGrid, { borderTopColor: theme.surface }]}>
                  {getVisiblePackageSummaries(editingClient).map((summary) => renderServiceTile(summary))}
                </View>
              </View>
            )}

            {editingClient && unpaidClientPackages.length > 0 && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionSubtitle}>Unpaid</ThemedText>
                <View style={styles.unpaidActionStack}>
                  {unpaidClientPackages.map(renderUnpaidPackageAction)}
                </View>
              </View>
            )}

            <View style={styles.section}>
              <ThemedText themeColor="textSecondary" style={styles.inputLabel}>
                {editingClient ? 'Add Package' : 'Initial Package'}
              </ThemedText>
              <View style={styles.packageGroupStack}>
                {packagesByService.map((group) => (
                  <View key={group.serviceType} style={styles.packageGroup}>
                    <View style={styles.packageGroupHeader}>
                      <ThemedText style={styles.packageGroupTitle}>{group.label} Packages</ThemedText>
                      <ThemedText themeColor="textSecondary" style={styles.packageGroupCount}>
                        {group.packages.length}
                      </ThemedText>
                    </View>
                    <View style={styles.packageOptionStack}>
                      {group.packages.map(renderPackageOption)}
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {editingClient && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionSubtitle}>Package History</ThemedText>
                {editingClient.client_packages.length > 0 ? (
                  editingClient.client_packages.map(renderPackageHistoryRow)
                ) : (
                  <ThemedText themeColor="textSecondary" style={styles.emptyHistoryText}>No package history.</ThemedText>
                )}
              </View>
            )}

            <TouchableOpacity style={[styles.saveButton, { backgroundColor: theme.primary }]} onPress={handleSave} activeOpacity={0.8}>
              <ThemedText style={[styles.saveButtonText, { color: theme.onPrimary }]}>{editingClient ? 'Save Details' : 'Create Client'}</ThemedText>
            </TouchableOpacity>
        </BottomSheetScrollView>
      </BottomSheetModal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  headerTitle: { fontSize: 24, fontWeight: '800', textTransform: 'uppercase' },
  headerMeta: { fontSize: 13, fontWeight: '700', marginTop: 2 },

  searchContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 10, borderRadius: Spacing.two, marginBottom: Spacing.three },
  searchIcon: { marginRight: Spacing.two },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', padding: 0 },
  filterBar: { minHeight: 46, paddingHorizontal: Spacing.three, flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  filterChip: { borderWidth: 1, height: 34, maxHeight: 34, borderRadius: 17, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', alignSelf: 'center' },
  filterChipText: { fontSize: 13, lineHeight: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },

  listContent: { paddingHorizontal: Spacing.three, paddingBottom: 100 },
  clientCard: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, marginBottom: 7, gap: 6, borderWidth: 1, borderColor: 'rgba(128,128,128,0.14)' },
  clientCardBody: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  clientAvatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  clientAvatarText: { fontSize: 12, lineHeight: 14, fontWeight: '900' },
  clientCardContent: { flex: 1, minWidth: 0, gap: 7 },
  clientCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  clientIdentity: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  clientPhone: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  clientAffordance: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, paddingTop: 1 },
  clientStatePill: { flexShrink: 1, maxWidth: 132, minHeight: 24, borderWidth: 1, borderRadius: 12, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
  clientStatePillText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },

  serviceBalanceText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  serviceTile: { flex: 1, minWidth: 112, minHeight: 42, paddingLeft: 10, paddingVertical: 2, justifyContent: 'center', overflow: 'hidden' },
  serviceTileAccent: { position: 'absolute', left: 0, top: 5, bottom: 5, width: 3, borderRadius: 2 },
  serviceTileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  serviceTileLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0 },
  serviceTileValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' },
  serviceTileValue: { fontSize: 19, lineHeight: 23, fontWeight: '600', fontVariant: ['tabular-nums'] },
  serviceTileCaption: { fontSize: 11, fontWeight: '600' },
  emptyText: { textAlign: 'center', marginTop: Spacing.five },
  skeletonList: { gap: 8 },
  skeletonCard: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, gap: 7, borderWidth: 1, borderColor: 'rgba(128,128,128,0.14)' },
  skeletonHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  skeletonMetaRow: { flex: 1, minWidth: 0, gap: 7 },
  skeletonTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  skeletonLineLarge: { width: '55%', height: 16, borderRadius: 4 },
  skeletonLineSmall: { width: '38%', height: 12, borderRadius: 4 },
  skeletonAvatar: { width: 34, height: 34, borderRadius: 17 },
  skeletonBadge: { width: 64, height: 22, borderRadius: 11 },
  skeletonStatusRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  skeletonStatusLine: { width: '70%', height: 12, borderRadius: 4 },
  fab: { position: 'absolute', bottom: Spacing.four, right: Spacing.four, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },

  sheetScroll: { flex: 1 },
  sheetScrollContent: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: 40 },
  sheetTitle: { fontSize: 20, fontWeight: '800', marginBottom: Spacing.three },
  sheetSummary: { borderWidth: 1, borderRadius: 8, padding: 14, gap: Spacing.two, marginBottom: Spacing.three },
  sheetSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  sheetSummaryAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#ED2024', justifyContent: 'center', alignItems: 'center' },
  sheetSummaryInitials: { fontSize: 14, fontWeight: '900' },
  sheetSummaryText: { flex: 1 },
  sheetSummaryName: { fontSize: 17, fontWeight: '900' },
  sheetSummaryMeta: { fontSize: 13, fontWeight: '700' },
  sheetSummaryStatusRow: { flexDirection: 'row', alignItems: 'center' },
  statusPill: { borderWidth: 1, borderRadius: 15, minHeight: 30, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  historyLinkButton: { borderWidth: 1, borderRadius: 8, minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  historyLinkLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  historyLinkText: { fontSize: 14, lineHeight: 18, fontWeight: '900' },
  inputLabelRow: { minHeight: 30, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  inputLabel: { fontWeight: '600', marginBottom: 6, fontSize: 13 },
  inputLabelInline: { marginBottom: 0 },
  copyPhoneButton: { minHeight: 28, borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyPhoneText: { fontSize: 12, lineHeight: 14, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, fontSize: 15, marginBottom: Spacing.three },

  section: { marginBottom: Spacing.three },
  sectionSubtitle: { fontSize: 15, fontWeight: '800', marginBottom: Spacing.two },
  balanceGrid: { flexDirection: 'row', gap: Spacing.three, borderTopWidth: 1, paddingTop: Spacing.two },
  packageGroupStack: { gap: Spacing.three },
  packageGroup: { gap: Spacing.two },
  packageGroupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  packageGroupTitle: { fontSize: 14, fontWeight: '900' },
  packageGroupCount: { fontSize: 12, fontWeight: '800' },
  packageOptionStack: { gap: Spacing.two },
  packageOption: { borderWidth: 1, borderRadius: 8, minHeight: 64, padding: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  packageOptionMain: { flex: 1 },
  packageOptionTitle: { fontSize: 14, fontWeight: '900', marginBottom: 2 },
  packageOptionMeta: { fontSize: 12, fontWeight: '700' },
  inlineAddButton: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  radioMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  radioMarkInner: { width: 12, height: 12, borderRadius: 6 },

  unpaidActionStack: { gap: Spacing.two },
  unpaidActionRow: { minHeight: 62, borderWidth: 1, borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  unpaidActionMain: { flex: 1, minWidth: 0 },
  unpaidActionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: 4 },
  unpaidActionTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '900' },
  unpaidActionMeta: { fontSize: 12, fontWeight: '700' },
  quickMarkPaidButton: { minWidth: 94, borderWidth: 1, minHeight: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 7, borderRadius: Spacing.two },
  quickMarkPaidText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },

  historyCard: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: Spacing.two, gap: Spacing.two },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  historyMain: { flex: 1 },
  historyTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two, marginBottom: 4 },
  historyTitle: { fontSize: 14, fontWeight: '800' },
  historyServicePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  historyServiceText: { fontSize: 11, fontWeight: '800' },
  historyMeta: { fontSize: 12, fontWeight: '600', marginBottom: 3 },
  historyStatus: { fontSize: 12, fontWeight: '800' },
  historyActionColumn: { width: 92, alignItems: 'stretch', gap: 6 },
  remainingBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center' },
  remainingValue: { fontSize: 17, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  remainingLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  markPaidButton: { borderWidth: 1, minHeight: 30, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6, borderRadius: Spacing.two },
  markPaidText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },
  historyStatusPill: { borderWidth: 1, minHeight: 30, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6, borderRadius: Spacing.two },
  historyStatusPillText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },
  historySmallButton: { borderWidth: 1, minHeight: 28, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 5, borderRadius: Spacing.two },
  historySmallButtonText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },
  adjustCreditsPanel: { borderTopWidth: 1, paddingTop: Spacing.two, flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  adjustCreditsInputColumn: { flex: 1, gap: 4 },
  adjustCreditsLabel: { fontSize: 11, lineHeight: 13, fontWeight: '800' },
  adjustCreditsInput: { borderWidth: 1, borderRadius: Spacing.two, minHeight: 36, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700' },
  adjustCreditsButton: { minWidth: 68, minHeight: 36, borderWidth: 1, borderRadius: Spacing.two, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10 },
  adjustCreditsButtonText: { fontSize: 12, lineHeight: 14, fontWeight: '900' },
  emptyHistoryText: { textAlign: 'center', paddingVertical: Spacing.three, fontWeight: '600' },

  saveButton: { paddingVertical: 13, borderRadius: Spacing.two, alignItems: 'center', marginTop: Spacing.two },
  saveButtonText: { fontWeight: '800', fontSize: 15 },
});
