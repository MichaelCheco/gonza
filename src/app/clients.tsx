// src/app/(tabs)/clients.tsx
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import dayjs from 'dayjs';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '../../utils/supabase';

export default function ClientsScreen() {
    const theme = useTheme();

    const [searchQuery, setSearchQuery] = useState('');
    const [clients, setClients] = useState<any[]>([]);
    const [packages, setPackages] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [editingClient, setEditingClient] = useState<any | null>(null);
    const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);

    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');

    const bottomSheetModalRef = useRef<BottomSheetModal>(null);
    const snapPoints = useMemo(() => ['70%'], []);

    const renderBackdrop = useCallback(
        (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />,
        []
    );
    console.log(packages, ' packages ')
    // --- Database Fetching ---
    // --- Database Fetching ---
    const fetchData = async () => {
        setLoading(true); 

        const [clientsRes, packagesRes] = await Promise.all([
            supabase.from('clients').select(`
                id, first_name, last_name, phone,
                client_packages (
                    id, classes_remaining, expiration_date, payment_status, package_id,
                    packages ( name, total_classes, expires_in_weeks )
                )
            `).order('first_name', { ascending: true }),
            supabase.from('packages').select('*').order('id', { ascending: true })
        ]);

        // Log any errors fetching packages
        if (packagesRes.error) {
            console.error("Packages Fet ch Error:", packagesRes.error);
            Alert.alert("Packages Error", packagesRes.error.message);
        } else if (packagesRes.data) {
            console.log("Fetched packages successfully!:", packagesRes.data.length);
            setPackages(packagesRes.data);
            if (packagesRes.data.length > 0 && !selectedPackageId) {
                setSelectedPackageId(packagesRes.data[0].id);
            }
        }

        // Log any errors fetching clients
        if (clientsRes.error) {
            console.error("Clients Fetch Error:", clientsRes.error);
            Alert.alert("Clients Error", clientsRes.error.message);
        } else if (clientsRes.data) {
            const processedClients = clientsRes.data.map(client => {
                const sortedPackages = (client.client_packages as any[] || []).sort((a, b) => b.id - a.id);
                return {
                    ...client,
                    name: `${client.first_name} ${client.last_name}`.trim(),
                    activePackage: sortedPackages[0] || null
                };
            });
            setClients(processedClients);
        }

        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const filteredClients = useMemo(() => {
        return clients.filter(client =>
            client.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery, clients]);

    // --- Action Handlers ---
    const handleAddClient = () => {
        setEditingClient(null);
        setFullName('');
        setPhone('');
        if (packages.length > 0) setSelectedPackageId(packages[0].id);
        bottomSheetModalRef.current?.present();
    };
 
    const handleClientPress = (client: any) => {
        setEditingClient(client);
        setFullName(client.name);
        setPhone(client.phone || '');
        if (client.activePackage) setSelectedPackageId(client.activePackage.package_id);
        bottomSheetModalRef.current?.present();
    };

    const closeBottomSheet = () => bottomSheetModalRef.current?.dismiss();

    const handleRenew = async () => {
        if (!editingClient || !selectedPackageId) return;

        const pkg = packages.find(p => p.id === selectedPackageId);
        if (!pkg) return;

        let expDate = null;
        if (pkg.expires_in_weeks) {
            expDate = dayjs().add(pkg.expires_in_weeks, 'week').format('YYYY-MM-DD');
        }

        const isSwitching = editingClient.activePackage?.package_id !== selectedPackageId;

        Alert.alert(
            isSwitching ? "Change Package & Renew" : "Confirm Renewal",
            `Renew ${editingClient.name} with a ${pkg.name}?\n\nClasses: +${pkg.total_classes}\nExpires: ${expDate ? dayjs(expDate).format('MMM D, YYYY') : 'Never'}`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Renew & Mark Unpaid", onPress: async () => {
                        const { error } = await supabase.from('client_packages').insert({
                            client_id: editingClient.id,
                            package_id: pkg.id,
                            classes_remaining: pkg.total_classes,
                            expiration_date: expDate,
                            payment_status: 'unpaid' // Default to unpaid until they hand over the cash/Venmo
                        });

                        if (error) Alert.alert("Database Error", error.message);
                        else {
                            fetchData();
                            closeBottomSheet();
                        }
                    }
                }
            ]
        );
    };

    const handleMarkPaid = async () => {
        if (!editingClient || !editingClient.activePackage) return;

        const { error } = await supabase.from('client_packages')
            .update({ payment_status: 'paid' })
            .eq('id', editingClient.activePackage.id);

        if (error) Alert.alert("Database Error", error.message);
        else {
            fetchData();
            closeBottomSheet();
        }
    };

    const handleSave = async () => {
        if (!fullName) return Alert.alert("Error", "Please enter a name.");

        // UX Magic: We let the owner type a full name, but we split it for the database
        const [firstName, ...lastNameArr] = fullName.trim().split(' ');
        const lastName = lastNameArr.join(' ') || '';

        if (editingClient) {
            // Update Existing Client
            const { error } = await supabase.from('clients')
                .update({ first_name: firstName, last_name: lastName, phone })
                .eq('id', editingClient.id);

            if (error) Alert.alert("Error", error.message);
            else {
                fetchData();
                closeBottomSheet();
            }
        } else {
            // Create Brand New Client
            const pkg = packages.find(p => p.id === selectedPackageId);
            if (!pkg) return Alert.alert("Error", "Please select a package.");

            let expDate = null;
            if (pkg.expires_in_weeks) {
                expDate = dayjs().add(pkg.expires_in_weeks, 'week').format('YYYY-MM-DD');
            }

            // 1. Insert Client
            const { data: newClient, error: clientErr } = await supabase.from('clients')
                .insert({ first_name: firstName, last_name: lastName, phone })
                .select().single();

            if (clientErr) return Alert.alert("Error", clientErr.message);

            // 2. Insert their first Package Ledger
            const { error: pkgErr } = await supabase.from('client_packages').insert({
                client_id: newClient.id,
                package_id: pkg.id,
                classes_remaining: pkg.total_classes,
                expiration_date: expDate,
                payment_status: 'unpaid'
            });

            if (pkgErr) Alert.alert("Error", pkgErr.message);
            else {
                fetchData();
                closeBottomSheet();
            }
        }
    };

    // --- Dynamic Status Engine ---
    const getStatus = (activePackage: any) => {
        if (!activePackage) return { active: false, reason: 'No Active Package' };
        if (activePackage.payment_status === 'unpaid') return { active: false, reason: 'Unpaid Balance' };
        if (activePackage.classes_remaining <= 0) return { active: false, reason: 'Out of Classes' };
        if (activePackage.expiration_date && dayjs().isAfter(dayjs(activePackage.expiration_date).endOf('day'))) {
            return { active: false, reason: 'Package Expired' };
        }
        return { active: true, reason: 'Good to go' };
    };

    const renderClientCard = ({ item }: { item: any }) => {
        const activePackage = item.activePackage;
        const status = getStatus(activePackage);

        const isGoodToGo = status.active;
        const showReason = !isGoodToGo && status.reason !== 'Out of Classes';
        const statusColor = isGoodToGo ? theme.textSecondary : theme.primary;

        return (
            <TouchableOpacity activeOpacity={0.8} onPress={() => handleClientPress(item)}>
                <ThemedView type="surface" style={styles.clientCard}>
                    <View style={styles.clientCardHeader}>
                        <View>
                            <ThemedText style={styles.clientName}>{item.name}</ThemedText>
                            <ThemedText themeColor="textSecondary" style={styles.clientPhone}>{item.phone || 'No phone added'}</ThemedText>
                        </View>
                        {!isGoodToGo && (
                            <SymbolView name="exclamationmark.triangle.fill" size={20} tintColor={theme.primary} />
                        )}
                    </View>

                    {activePackage ? (
                        <View style={styles.packageContainer}>
                            <View style={[styles.packagePill, { backgroundColor: theme.backgroundElement }]}>
                                <ThemedText style={styles.packageTitle}>{activePackage.packages.name}</ThemedText>
                            </View>

                            <ThemedText style={[styles.statusText, { color: statusColor }]}>
                                {activePackage.classes_remaining} {activePackage.classes_remaining === 1 ? 'class' : 'classes'} left
                                {showReason ? ` • ${status.reason.toUpperCase()}` : ''}
                            </ThemedText>
                        </View>
                    ) : (
                        <ThemedText style={{ color: theme.primary, fontWeight: '600', marginTop: 4 }}>No package history.</ThemedText>
                    )}
                </ThemedView>
            </TouchableOpacity>
        );
    };

    return (
        <ThemedView style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.header}>
                    <ThemedText style={styles.headerTitle}>Clients</ThemedText>
                </View>

                <View style={[styles.searchContainer, { backgroundColor: theme.backgroundElement }]}>
                    <SymbolView name="magnifyingglass" size={18} tintColor={theme.textSecondary} style={styles.searchIcon} />
                    <TextInput
                        style={[styles.searchInput, { color: theme.text }]}
                        placeholder="Search clients..."
                        placeholderTextColor={theme.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        clearButtonMode="while-editing"
                    />
                </View>

                {loading ? (
                    <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 40 }} />
                ) : (
                    <FlatList
                        data={filteredClients}
                        keyExtractor={(item) => item.id.toString()}
                        renderItem={renderClientCard}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.emptyText}>No clients found.</ThemedText>}
                    />
                )}

                <TouchableOpacity style={[styles.fab, { backgroundColor: theme.primary }]} activeOpacity={0.8} onPress={handleAddClient}>
                    <SymbolView name="person.badge.plus.fill" size={22} tintColor="#FFFFFF" />
                </TouchableOpacity>
            </SafeAreaView>

            <BottomSheetModal
                ref={bottomSheetModalRef}
                index={0}
                snapPoints={snapPoints}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: theme.backgroundElement }}
                handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}
                keyboardBlurBehavior="restore"
            >
                <BottomSheetView style={styles.sheetContent}>
                    <ThemedText style={styles.sheetTitle}>
                        {editingClient ? 'Client Details' : 'New Client'}
                    </ThemedText>

                    <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Name</ThemedText>
                    <BottomSheetTextInput
                        style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
                        placeholder="e.g. Apollo Creed"
                        value={fullName}
                        onChangeText={setFullName}
                        placeholderTextColor={theme.textSecondary}
                    />

                    <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Phone Number</ThemedText>
                    <BottomSheetTextInput
                        style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
                        placeholder="e.g. 201-250-3670"
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        placeholderTextColor={theme.textSecondary}
                    />

                    <View style={styles.packageSelectorContainer}>
                        <ThemedText themeColor="textSecondary" style={styles.inputLabel}>
                            {editingClient ? 'Active Package' : 'Initial Package'}
                        </ThemedText>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                            {packages.map((pkg) => {
                                const isSelected = selectedPackageId === pkg.id;
                                return (
                                    <TouchableOpacity
                                        key={pkg.id.toString()}
                                        style={[
                                            styles.chip,
                                            { backgroundColor: isSelected ? theme.text : theme.background, borderColor: isSelected ? theme.text : theme.surface }
                                        ]}
                                        onPress={() => setSelectedPackageId(pkg.id)}
                                    >
                                        <ThemedText type="small" style={{ color: isSelected ? theme.background : theme.text, fontWeight: '600' }}>
                                            {pkg.name}
                                        </ThemedText>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>

                    {editingClient && editingClient.activePackage && (
                        <View style={styles.actionsContainer}>
                            <ThemedText style={styles.sectionSubtitle}>Package Management</ThemedText>
                            <View style={styles.actionButtonsRow}>
                                <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.background, borderColor: theme.surface, borderWidth: 1 }]} onPress={handleRenew}>
                                    <SymbolView name="arrow.triangle.2.circlepath" size={16} tintColor={theme.text} />
                                    <ThemedText style={styles.actionButtonText}>Renew</ThemedText>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={handleMarkPaid}
                                    style={[
                                        styles.actionButton,
                                        { backgroundColor: editingClient.activePackage.payment_status === 'unpaid' ? '#28A745' : theme.background, borderColor: editingClient.activePackage.payment_status === 'unpaid' ? '#28A745' : theme.surface, borderWidth: 1 }
                                    ]}>
                                    <SymbolView name="dollarsign.circle.fill" size={16} tintColor={editingClient.activePackage.payment_status === 'unpaid' ? '#FFF' : theme.text} />
                                    <ThemedText style={[styles.actionButtonText, { color: editingClient.activePackage.payment_status === 'unpaid' ? '#FFF' : theme.text }]}>Mark Paid</ThemedText>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <TouchableOpacity style={[styles.saveButton, { backgroundColor: theme.primary }]} onPress={handleSave} activeOpacity={0.8}>
                        <ThemedText style={styles.saveButtonText}>Save Details</ThemedText>
                    </TouchableOpacity>
                </BottomSheetView>
            </BottomSheetModal>
        </ThemedView>
    );
}

// --- Styles ---
const styles = StyleSheet.create({
    container: { flex: 1 }, safeArea: { flex: 1 },
    header: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
    headerTitle: { fontSize: 24, fontWeight: '800', textTransform: 'uppercase' },

    searchContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 10, borderRadius: Spacing.two, marginBottom: Spacing.three },
    searchIcon: { marginRight: Spacing.two },
    searchInput: { flex: 1, fontSize: 15, fontWeight: '500', padding: 0 },

    listContent: { paddingHorizontal: Spacing.three, paddingBottom: 100 },
    clientCard: { padding: 16, borderRadius: 16, marginBottom: 12, gap: 12 },
    clientCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    clientName: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
    clientPhone: { fontSize: 14, fontWeight: '500' },

    packageContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    packagePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
    packageTitle: { fontSize: 13, fontWeight: '600' },
    statusText: { fontSize: 14, fontWeight: '700' },

    emptyText: { textAlign: 'center', marginTop: Spacing.five },

    fab: { position: 'absolute', bottom: Spacing.four, right: Spacing.four, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },

    sheetContent: { flex: 1, padding: Spacing.four, paddingTop: Spacing.two },
    sheetTitle: { fontSize: 20, fontWeight: '800', marginBottom: Spacing.three },
    inputLabel: { fontWeight: '600', marginBottom: 6, fontSize: 13 },
    input: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, fontSize: 15, marginBottom: Spacing.three },

    packageSelectorContainer: { marginBottom: Spacing.three },
    chipScroll: { gap: Spacing.two, paddingBottom: Spacing.two },
    chip: { borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 8, borderRadius: 20 },

    actionsContainer: { marginBottom: Spacing.three },
    sectionSubtitle: { fontSize: 15, fontWeight: '700', marginBottom: Spacing.two },
    actionButtonsRow: { flexDirection: 'row', gap: Spacing.two },
    actionButton: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.two, paddingVertical: 10, borderRadius: Spacing.two },
    actionButtonText: { fontWeight: '600', fontSize: 13 },

    saveButton: { paddingVertical: 12, borderRadius: Spacing.two, alignItems: 'center', marginTop: 'auto', marginBottom: Spacing.four },
    saveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});