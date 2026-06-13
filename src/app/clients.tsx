import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  calculateExpirationDateFromPackage,
  ClientPackageRow,
  getClientPackageStatus,
  getServiceLabel,
  PackageRow,
  SERVICE_TYPES,
  ServiceSummary,
  sortClientPackages,
  summarizePackagesByService,
} from '../../utils/gym-logic';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import dayjs from 'dayjs';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { AppSymbol } from '@/components/app-symbol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../utils/supabase';

type ClientRecord = {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  name: string;
  client_packages: ClientPackageRow[];
  packageSummaries: ServiceSummary[];
};

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

export default function ClientsScreen() {
  const theme = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ClientFilter>('all');
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCopied, setPhoneCopied] = useState(false);

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const hasLoadedRef = useRef(false);
  const fetchingRef = useRef(false);
  const snapPoints = useMemo(() => ['85%'], []);

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

  const decorateClient = useCallback((client: any): ClientRecord => {
    const ledger = sortClientPackages((client.client_packages || []) as ClientPackageRow[]);

    return {
      ...client,
      name: `${client.first_name} ${client.last_name}`.trim(),
      client_packages: ledger,
      packageSummaries: SERVICE_ORDER.map((serviceType) => summarizePackagesByService(ledger, serviceType)),
    };
  }, []);

  const fetchData = useCallback(async (focusedClientId?: number) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (!hasLoadedRef.current) setLoading(true);

    try {
      const [clientsRes, packagesRes] = await Promise.all([
        supabase
          .from('clients')
          .select(`
            id, first_name, last_name, phone,
            client_packages (
              id, client_id, package_id, classes_remaining, start_date, expiration_date, payment_status,
              packages ( id, name, price, total_classes, expires_in_weeks, service_type )
            )
          `)
          .order('first_name', { ascending: true }),
        supabase
          .from('packages')
          .select('id, name, price, total_classes, expires_in_weeks, service_type')
          .order('service_type', { ascending: true })
          .order('id', { ascending: true }),
      ]);

      if (packagesRes.error) {
        console.error('Packages Fetch Error:', packagesRes.error);
        Alert.alert('Packages Error', packagesRes.error.message);
      } else if (packagesRes.data) {
        const packageRows = packagesRes.data as PackageRow[];
        setPackages(packageRows);
        setSelectedPackageId((currentId) => {
          if (currentId && packageRows.some((pkg) => pkg.id === currentId)) return currentId;
          return packageRows[0]?.id ?? null;
        });
      }

      if (clientsRes.error) {
        console.error('Clients Fetch Error:', clientsRes.error);
        Alert.alert('Clients Error', clientsRes.error.message);
      } else if (clientsRes.data) {
        const processedClients = clientsRes.data.map(decorateClient);
        setClients(processedClients);

        if (focusedClientId) {
          const refreshedClient = processedClients.find((client) => client.id === focusedClientId) ?? null;
          setEditingClient(refreshedClient);
        }
      }
    } finally {
      hasLoadedRef.current = true;
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [decorateClient]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!phoneCopied) return;

    const timeout = setTimeout(() => setPhoneCopied(false), 1400);
    return () => clearTimeout(timeout);
  }, [phoneCopied]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedRef.current) fetchData();
    }, [fetchData])
  );

  const getClientAttention = useCallback((client: ClientRecord) => {
    const hasUnpaid = client.client_packages.some((clientPackage) => clientPackage.payment_status === 'unpaid');
    const hasUsableCredits = client.packageSummaries.some((summary) => summary.usableClasses > 0);
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

  const packagesByService = useMemo(() => {
    return SERVICE_ORDER.map((serviceType) => ({
      serviceType,
      label: getServiceLabel(serviceType),
      packages: packages.filter((pkg) => pkg.service_type === serviceType),
    }));
  }, [packages]);

  const selectedPackage = useMemo(() => {
    return packages.find((pkg) => pkg.id === selectedPackageId) ?? null;
  }, [packages, selectedPackageId]);

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
      classes_remaining: pkg.total_classes,
      start_date: startDate,
      expiration_date: calculateExpirationDateFromPackage(pkg, startDate),
      payment_status: 'unpaid',
    };
  };

  const handleAddClient = () => {
    setEditingClient(null);
    setFullName('');
    setPhone('');
    setPhoneCopied(false);
    setSelectedPackageId(packages[0]?.id ?? null);
    bottomSheetModalRef.current?.present();
  };

  const handleClientPress = (client: ClientRecord) => {
    setEditingClient(client);
    setFullName(client.name);
    setPhone(formatPhoneNumber(client.phone));
    setPhoneCopied(false);
    setSelectedPackageId(packages[0]?.id ?? null);
    bottomSheetModalRef.current?.present();
  };

  const closeBottomSheet = () => bottomSheetModalRef.current?.dismiss();

  const handlePhoneChange = (value: string) => {
    setPhone(formatPhoneNumber(value));
    if (phoneCopied) setPhoneCopied(false);
  };

  const handleCopyPhone = async () => {
    const formattedPhone = formatPhoneNumber(phone);
    if (!formattedPhone) return;

    await Clipboard.setStringAsync(formattedPhone);
    setPhoneCopied(true);
  };

  const handleAddPackage = (packageOverride?: PackageRow) => {
    const packageToAdd = packageOverride ?? selectedPackage;
    if (!editingClient || !packageToAdd) return;

    Alert.alert(
      'Add Package',
      `Add ${packageToAdd.name} to ${editingClient.name}?\n\nCredits: ${packageToAdd.total_classes}\nExpires: ${
        packageToAdd.expires_in_weeks ? `${packageToAdd.expires_in_weeks} weeks` : 'Never'
      }\nPayment: Unpaid`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add Package',
          onPress: async () => {
            const { error } = await supabase.from('client_packages').insert(buildClientPackageInsert(editingClient.id, packageToAdd));

            if (error) Alert.alert('Database Error', error.message);
            else fetchData(editingClient.id);
          },
        },
      ]
    );
  };

  const handleMarkPaid = async (clientPackageId: number) => {
    if (!editingClient) return;

    const { error } = await supabase
      .from('client_packages')
      .update({ payment_status: 'paid' })
      .eq('id', clientPackageId);

    if (error) Alert.alert('Update Failed', 'Could not mark this package paid. Please try again.');
    else fetchData(editingClient.id);
  };

  const handleVoidPackage = (clientPackage: ClientPackageRow) => {
    if (!editingClient) return;

    Alert.alert('Void Package', 'Void this unpaid, unused package? This removes it from active balances but keeps it in history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('client_packages')
            .update({ payment_status: 'voided', classes_remaining: 0 })
            .eq('id', clientPackage.id);

          if (error) Alert.alert('Void Failed', 'Could not void this package. Please try again.');
          else fetchData(editingClient.id);
        },
      },
    ]);
  };

  const handleAdjustPackageCredits = (clientPackage: ClientPackageRow) => {
    if (!editingClient) return;

    Alert.prompt(
      'Adjust Credits',
      'Enter the corrected number of remaining credits.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async (value?: string) => {
            const nextCredits = Number.parseInt(value ?? '', 10);

            if (!Number.isFinite(nextCredits) || nextCredits < 0) {
              return Alert.alert('Invalid Credits', 'Enter a whole number of 0 or more.');
            }

            const { error } = await supabase
              .from('client_packages')
              .update({ classes_remaining: nextCredits })
              .eq('id', clientPackage.id);

            if (error) Alert.alert('Adjustment Failed', 'Could not update credits. Please try again.');
            else fetchData(editingClient.id);
          },
        },
      ],
      'plain-text',
      String(clientPackage.classes_remaining),
      'number-pad'
    );
  };

  const handleSave = async () => {
    const trimmedName = fullName.trim();
    if (!trimmedName) return Alert.alert('Error', 'Please enter a name.');
    const formattedPhone = formatPhoneNumber(phone);

    const [firstName, ...lastNameArr] = trimmedName.split(/\s+/);
    const lastName = lastNameArr.join(' ');

    if (editingClient) {
      const { error } = await supabase
        .from('clients')
        .update({ first_name: firstName, last_name: lastName, phone: formattedPhone || null })
        .eq('id', editingClient.id);

      if (error) Alert.alert('Error', error.message);
      else {
        await fetchData(editingClient.id);
        closeBottomSheet();
      }

      return;
    }

    if (!selectedPackage) return Alert.alert('Error', 'Please select a package.');

    const { data: newClient, error: clientErr } = await supabase
      .from('clients')
      .insert({ first_name: firstName, last_name: lastName, phone: formattedPhone || null })
      .select()
      .single();

    if (clientErr) return Alert.alert('Error', clientErr.message);

    const { error: pkgErr } = await supabase
      .from('client_packages')
      .insert(buildClientPackageInsert(newClient.id, selectedPackage));

    if (pkgErr) Alert.alert('Error', pkgErr.message);
    else {
      await fetchData();
      closeBottomSheet();
    }
  };

  const getStatusPalette = (summary: ServiceSummary) => {
    const hasPackage = summary.totalCount > 0;
    const isUnpaid = summary.unpaidCount > 0;
    const isEmpty = !hasPackage || summary.usableClasses === 0;

    if (isUnpaid) {
      return {
        background: theme.background,
        border: theme.warning,
        text: theme.text,
        muted: theme.textSecondary,
        icon: 'dollarsign.circle.fill' as const,
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

  const getAttentionBadge = (attention: ReturnType<typeof getClientAttention>) => {
    if (attention.active) return null;

    if (attention.type === 'unpaid') {
      return {
        label: 'Unpaid',
        icon: 'dollarsign.circle.fill' as const,
        color: theme.warning,
      };
    }

    return {
      label: attention.reason === 'No packages' ? 'No packages' : 'No credits',
      icon: 'exclamationmark.triangle.fill' as const,
      color: theme.primary,
    };
  };

  const getServiceStatusLabel = (summary: ServiceSummary) => {
    if (summary.unpaidCount > 0) return `${summary.label} unpaid`;
    if (summary.totalCount === 0) return `${summary.label} -`;
    if (summary.usableClasses > 0) return `${summary.label} ${summary.usableClasses}`;
    return `${summary.label} 0`;
  };

  const getServiceStatusPalette = (summary: ServiceSummary) => {
    if (summary.unpaidCount > 0) {
      return {
        background: theme.backgroundElement,
        border: theme.warning,
        text: theme.warning,
      };
    }

    if (summary.totalCount > 0 && summary.usableClasses === 0) {
      return {
        background: theme.backgroundElement,
        border: theme.primary,
        text: theme.primary,
      };
    }

    return {
      background: theme.backgroundElement,
      border: theme.backgroundSelected,
      text: summary.totalCount > 0 ? theme.text : theme.textSecondary,
    };
  };

  const renderServiceStatusPill = (summary: ServiceSummary) => {
    const palette = getServiceStatusPalette(summary);

    return (
      <View
        key={summary.serviceType}
        style={[
          styles.serviceStatusPill,
          { backgroundColor: palette.background, borderColor: palette.border },
        ]}
      >
        <ThemedText numberOfLines={1} style={[styles.serviceStatusPillText, { color: palette.text }]}>
          {getServiceStatusLabel(summary)}
        </ThemedText>
      </View>
    );
  };

  const renderServiceTile = (summary: ServiceSummary) => {
    const hasPackage = summary.totalCount > 0;
    const palette = getStatusPalette(summary);
    const value = hasPackage ? (summary.usableClasses > 0 ? `${summary.usableClasses}` : summary.reason) : 'None';
    const caption = hasPackage && summary.usableClasses > 0 ? 'left' : summary.label;

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

  const renderPackageHistoryRow = (clientPackage: ClientPackageRow) => {
    const status = getClientPackageStatus(clientPackage);
    const pkg = clientPackage.packages;
    const isUnpaid = clientPackage.payment_status === 'unpaid';
    const isVoided = clientPackage.payment_status === 'voided';
    const canVoid = isUnpaid && !!pkg && clientPackage.classes_remaining === pkg.total_classes;
    const serviceLabel = pkg ? getServiceLabel(pkg.service_type) : 'Package';
    const expirationText = clientPackage.expiration_date
      ? `Expires ${dayjs(clientPackage.expiration_date).format('MMM D, YYYY')}`
      : 'No expiration';

    return (
      <View key={clientPackage.id} style={[styles.historyRow, { borderColor: theme.surface, backgroundColor: theme.background }]}>
        <View style={styles.historyMain}>
          <View style={styles.historyTitleRow}>
            <ThemedText style={styles.historyTitle}>{pkg?.name ?? 'Unknown Package'}</ThemedText>
            <View style={[styles.historyServicePill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.historyServiceText}>{serviceLabel}</ThemedText>
            </View>
          </View>
          <ThemedText themeColor="textSecondary" style={styles.historyMeta}>
            {clientPackage.classes_remaining} left • {expirationText}
          </ThemedText>
          <ThemedText style={[styles.historyStatus, { color: isVoided ? theme.textSecondary : status.active ? theme.success : theme.primary }]}>
            {status.reason}
          </ThemedText>
        </View>

        <View style={styles.historyActionColumn}>
          <View style={[styles.remainingBadge, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.remainingValue}>{clientPackage.classes_remaining}</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.remainingLabel}>left</ThemedText>
          </View>

          {!isVoided && (
            <TouchableOpacity
              style={[styles.historySmallButton, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}
              onPress={() => handleAdjustPackageCredits(clientPackage)}
              activeOpacity={0.8}
            >
              <AppSymbol name="slider.horizontal.3" size={14} tintColor={theme.textSecondary} />
              <ThemedText style={[styles.historySmallButtonText, { color: theme.textSecondary }]}>Adjust</ThemedText>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.markPaidButton,
              {
                backgroundColor: isUnpaid ? theme.success : theme.control,
                borderColor: isUnpaid ? theme.success : theme.surface,
              },
            ]}
            onPress={() => handleMarkPaid(clientPackage.id)}
            disabled={!isUnpaid || isVoided}
            activeOpacity={isUnpaid ? 0.8 : 1}
          >
            <AppSymbol name="dollarsign.circle.fill" size={15} tintColor={isUnpaid ? theme.onSuccess : theme.textSecondary} />
            <ThemedText style={[styles.markPaidText, { color: isUnpaid ? theme.onSuccess : theme.textSecondary }]}>
              {isUnpaid ? 'Mark Paid' : isVoided ? 'Voided' : 'Paid'}
            </ThemedText>
          </TouchableOpacity>

          {canVoid && (
            <TouchableOpacity
              style={[styles.historySmallButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
              onPress={() => handleVoidPackage(clientPackage)}
              activeOpacity={0.8}
            >
              <AppSymbol name="xmark.circle.fill" size={14} tintColor={theme.primary} />
              <ThemedText style={[styles.historySmallButtonText, { color: theme.primary }]}>Void</ThemedText>
            </TouchableOpacity>
          )}
        </View>
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
          {label}
        </ThemedText>
        <View style={[styles.filterCountPill, { backgroundColor: isSelected ? theme.onControlSelected : theme.background }]}>
          <ThemedText style={[styles.filterCountText, { color: isSelected ? theme.controlSelected : theme.textSecondary }]}>
            {count}
          </ThemedText>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPackageOption = (pkg: PackageRow) => {
    const isSelected = selectedPackageId === pkg.id;

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
        onPress={() => setSelectedPackageId(pkg.id)}
        activeOpacity={0.8}
      >
        <View style={styles.packageOptionMain}>
          <ThemedText style={styles.packageOptionTitle}>{pkg.name}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.packageOptionMeta}>
            {pkg.total_classes} credits • {pkg.expires_in_weeks ? `${pkg.expires_in_weeks} weeks` : 'No expiration'}
          </ThemedText>
        </View>

        {editingClient ? (
          <TouchableOpacity
            style={[styles.inlineAddButton, { backgroundColor: theme.controlSelected }]}
            onPress={() => handleAddPackage(pkg)}
            activeOpacity={0.8}
          >
            <AppSymbol name="plus" size={14} tintColor={theme.onControlSelected} weight="bold" />
          </TouchableOpacity>
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
    const attentionBadge = getAttentionBadge(attention);

    return (
      <TouchableOpacity activeOpacity={0.8} onPress={() => handleClientPress(item)}>
        <ThemedView type="surface" style={styles.clientCard}>
          <View style={styles.clientCardHeader}>
            <View style={styles.clientIdentity}>
              <ThemedText numberOfLines={1} style={styles.clientName}>{item.name}</ThemedText>
            </View>
            {attentionBadge && (
              <View style={[styles.attentionPill, { backgroundColor: theme.backgroundElement, borderColor: attentionBadge.color }]}>
                <AppSymbol name={attentionBadge.icon} size={12} tintColor={attentionBadge.color} />
                <ThemedText numberOfLines={1} style={[styles.attentionPillText, { color: attentionBadge.color }]}>
                  {attentionBadge.label}
                </ThemedText>
              </View>
            )}
          </View>

          <View style={styles.clientMetaRow}>
            <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.clientPhone}>
              {formatPhoneNumber(item.phone) || 'No phone added'}
            </ThemedText>
            <View style={styles.serviceStatusRow}>
              {item.packageSummaries.map(renderServiceStatusPill)}
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
            <View style={[styles.skeletonLineLarge, { backgroundColor: theme.backgroundElement }]} />
            <View style={[styles.skeletonBadge, { backgroundColor: theme.backgroundElement }]} />
          </View>
          <View style={styles.skeletonMetaRow}>
            <View style={[styles.skeletonLineSmall, { backgroundColor: theme.backgroundElement }]} />
            <View style={styles.skeletonStatusRow}>
              <View style={[styles.skeletonStatusPill, { backgroundColor: theme.backgroundElement }]} />
              <View style={[styles.skeletonStatusPill, { backgroundColor: theme.backgroundElement }]} />
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
                      {editingClient.name
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join('')
                        .toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.sheetSummaryText}>
                    <ThemedText style={styles.sheetSummaryName}>{editingClient.name}</ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.sheetSummaryMeta}>
                      {formatPhoneNumber(editingClient.phone) || 'No phone added'}
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

            {editingClient && (
              <View style={styles.section}>
                <ThemedText style={styles.sectionSubtitle}>Balances</ThemedText>
                <View style={[styles.balanceGrid, { borderTopColor: theme.surface }]}>
                  {getVisiblePackageSummaries(editingClient).map((summary) => renderServiceTile(summary))}
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
  filterChip: { borderWidth: 1, height: 34, maxHeight: 34, borderRadius: 17, paddingLeft: 12, paddingRight: 6, flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 8 },
  filterChipText: { fontSize: 13, lineHeight: 16, fontWeight: '800' },
  filterCountPill: { minWidth: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  filterCountText: { fontSize: 12, lineHeight: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },

  listContent: { paddingHorizontal: Spacing.three, paddingBottom: 100 },
  clientCard: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, marginBottom: 7, gap: 6, borderWidth: 1, borderColor: 'rgba(128,128,128,0.14)' },
  clientCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  clientIdentity: { flex: 1, minWidth: 0 },
  clientName: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  clientPhone: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  attentionPill: { flexShrink: 0, maxWidth: 108, minHeight: 24, borderWidth: 1, borderRadius: 12, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
  attentionPillText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },

  clientMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  serviceStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  serviceStatusPill: { height: 23, maxWidth: 86, borderWidth: 1, borderRadius: 12, paddingHorizontal: 7, justifyContent: 'center', alignItems: 'center' },
  serviceStatusPillText: { fontSize: 11, lineHeight: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
  skeletonHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  skeletonMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  skeletonLineLarge: { width: '45%', height: 16, borderRadius: 4 },
  skeletonLineSmall: { width: '30%', height: 12, borderRadius: 4 },
  skeletonBadge: { width: 64, height: 22, borderRadius: 11 },
  skeletonStatusRow: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  skeletonStatusPill: { width: 58, height: 23, borderRadius: 12 },
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

  historyRow: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
  historySmallButton: { borderWidth: 1, minHeight: 28, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 5, borderRadius: Spacing.two },
  historySmallButtonText: { fontSize: 11, lineHeight: 13, fontWeight: '800' },
  emptyHistoryText: { textAlign: 'center', paddingVertical: Spacing.three, fontWeight: '600' },

  saveButton: { paddingVertical: 13, borderRadius: Spacing.two, alignItems: 'center', marginTop: Spacing.two },
  saveButtonText: { fontWeight: '800', fontSize: 15 },
});
