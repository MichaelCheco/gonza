// src/app/clients.tsx
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// --- Mock Data (Joined Clients & Packages) ---
const MOCK_CLIENTS = [
    { id: '1', name: 'John Doe', phone: '555-0101', package: 'Monthly Membership', classesRemaining: 2, paymentStatus: 'paid' },
    { id: '2', name: 'Jane Smith', phone: '555-0102', package: '8-Class Pack', classesRemaining: 0, paymentStatus: 'unpaid' },
    { id: '3', name: 'Mike Tyson', phone: '555-0103', package: 'Personal Training', classesRemaining: 6, paymentStatus: 'paid' },
    { id: '4', name: 'Evander Holyfield', phone: '555-0104', package: 'First Class Promo', classesRemaining: 1, paymentStatus: 'paid' },
];

export default function ClientsScreen() {
    const theme = useTheme();

    // --- State ---
    const [searchQuery, setSearchQuery] = useState('');
    const [editingClient, setEditingClient] = useState<typeof MOCK_CLIENTS[0] | null>(null);

    // --- Bottom Sheet Setup ---
    const bottomSheetModalRef = useRef<BottomSheetModal>(null);
    const snapPoints = useMemo(() => ['75%'], []);

    const renderBackdrop = useCallback(
        (props: any) => (
            <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
        ),
        []
    );

    // --- Derived Data ---
    const filteredClients = useMemo(() => {
        return MOCK_CLIENTS.filter(client =>
            client.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery]);

    // --- Handlers ---
    const handleAddClient = () => {
        setEditingClient(null);
        bottomSheetModalRef.current?.present();
    };

    const handleClientPress = (client: typeof MOCK_CLIENTS[0]) => {
        setEditingClient(client);
        bottomSheetModalRef.current?.present();
    };

    const closeBottomSheet = () => {
        bottomSheetModalRef.current?.dismiss();
    };

    // --- Renderers ---
    const renderClientCard = ({ item }: { item: typeof MOCK_CLIENTS[0] }) => {
        // Determine status colors based on business logic
        const needsAttention = item.classesRemaining === 0 || item.paymentStatus === 'unpaid';
        const statusColor = needsAttention ? theme.primary : '#28A745'; // Gonza Red for warning, standard green for good

        return (
            <TouchableOpacity activeOpacity={0.8} onPress={() => handleClientPress(item)}>
                <ThemedView type="surface" style={styles.clientCard}>
                    <View style={styles.clientHeader}>
                        <ThemedText style={styles.clientName}>{item.name}</ThemedText>
                        {needsAttention && (
                            <SymbolView name="exclamationmark.circle.fill" size={20} tintColor={theme.primary} />
                        )}
                    </View>

                    <ThemedText themeColor="textSecondary" type="small" style={{ marginBottom: Spacing.one }}>
                        {item.phone}
                    </ThemedText>

                    <View style={styles.packageRow}>
                        <View style={styles.packageDetails}>
                            <ThemedText style={styles.packageTitle}>{item.package}</ThemedText>
                            <ThemedText type="small" style={{ color: statusColor, fontWeight: '700' }}>
                                {item.classesRemaining} classes left • {item.paymentStatus.toUpperCase()}
                            </ThemedText>
                        </View>
                    </View>
                </ThemedView>
            </TouchableOpacity>
        );
    };

    return (
        <ThemedView style={styles.container}>
            <SafeAreaView style={styles.safeArea}>

                {/* Header */}
                <View style={styles.header}>
                    <ThemedText style={styles.headerTitle}>Clients</ThemedText>
                </View>

                {/* Search Bar */}
                <View style={[styles.searchContainer, { backgroundColor: theme.backgroundElement }]}>
                    <SymbolView name="magnifyingglass" size={20} tintColor={theme.textSecondary} style={styles.searchIcon} />
                    <TextInput
                        style={[styles.searchInput, { color: theme.text }]}
                        placeholder="Search clients..."
                        placeholderTextColor={theme.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        clearButtonMode="while-editing"
                    />
                </View>

                {/* Client List */}
                <FlatList
                    data={filteredClients}
                    keyExtractor={(item) => item.id}
                    renderItem={renderClientCard}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <ThemedText themeColor="textSecondary" style={styles.emptyText}>
                            No clients found.
                        </ThemedText>
                    }
                />

                {/* Floating Action Button */}
                <TouchableOpacity
                    style={[styles.fab, { backgroundColor: theme.primary }]}
                    activeOpacity={0.8}
                    onPress={handleAddClient}
                >
                    <SymbolView name="person.badge.plus.fill" size={28} tintColor="#FFFFFF" />
                </TouchableOpacity>

            </SafeAreaView>

            {/* Client Detail / Add Client Bottom Sheet */}
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

                    {/* Core Info Inputs */}
                    <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Name</ThemedText>
                    <BottomSheetTextInput
                        style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
                        placeholder="e.g. Apollo Creed"
                        defaultValue={editingClient?.name}
                        placeholderTextColor={theme.textSecondary}
                    />

                    <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Phone Number</ThemedText>
                    <BottomSheetTextInput
                        style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
                        placeholder="e.g. 555-1234"
                        defaultValue={editingClient?.phone}
                        keyboardType="phone-pad"
                        placeholderTextColor={theme.textSecondary}
                    />

                    {/* Package Actions (Only show if editing an existing client) */}
                    {editingClient && (
                        <View style={styles.actionsContainer}>
                            <ThemedText style={styles.sectionSubtitle}>Package Management</ThemedText>

                            <View style={styles.actionButtonsRow}>
                                {/* Renew Button */}
                                <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.background, borderColor: theme.surface, borderWidth: 1 }]}>
                                    <SymbolView name="arrow.triangle.2.circlepath" size={20} tintColor={theme.text} />
                                    <ThemedText style={styles.actionButtonText}>Renew</ThemedText>
                                </TouchableOpacity>

                                {/* Mark Paid Button (Shows Red if unpaid) */}
                                <TouchableOpacity style={[
                                    styles.actionButton,
                                    { backgroundColor: editingClient.paymentStatus === 'unpaid' ? theme.primary : theme.background, borderColor: theme.surface, borderWidth: 1 }
                                ]}>
                                    <SymbolView name="dollarsign.circle.fill" size={20} tintColor={editingClient.paymentStatus === 'unpaid' ? '#FFF' : theme.text} />
                                    <ThemedText style={[styles.actionButtonText, { color: editingClient.paymentStatus === 'unpaid' ? '#FFF' : theme.text }]}>
                                        Mark Paid
                                    </ThemedText>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    {/* Primary Save Button */}
                    <TouchableOpacity
                        style={[styles.saveButton, { backgroundColor: theme.primary }]}
                        onPress={closeBottomSheet}
                        activeOpacity={0.8}
                    >
                        <ThemedText style={styles.saveButtonText}>Save</ThemedText>
                    </TouchableOpacity>

                </BottomSheetView>
            </BottomSheetModal>
        </ThemedView>
    );
}

// --- Styles ---
const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
    headerTitle: { fontSize: 28, fontWeight: '900', textTransform: 'uppercase' },

    // Search Bar
    searchContainer: {
        flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.four,
        paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
        borderRadius: Spacing.three, marginBottom: Spacing.four
    },
    searchIcon: { marginRight: Spacing.two },
    searchInput: { flex: 1, fontSize: 16, fontWeight: '500' },

    // List & Cards
    listContent: { paddingHorizontal: Spacing.four, paddingBottom: 100 },
    clientCard: { padding: Spacing.four, borderRadius: Spacing.three, marginBottom: Spacing.three },
    clientHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    clientName: { fontSize: 18, fontWeight: '800' },
    packageRow: { marginTop: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, borderTopColor: 'rgba(150,150,150,0.2)' },
    packageDetails: { gap: 2 },
    packageTitle: { fontSize: 16, fontWeight: '600' },
    emptyText: { textAlign: 'center', marginTop: Spacing.five },

    // FAB
    fab: {
        position: 'absolute', bottom: Spacing.four, right: Spacing.four,
        width: 60, height: 60, borderRadius: 30, justifyContent: 'center',
        alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 4, elevation: 6
    },

    // Bottom Sheet
    sheetContent: { flex: 1, padding: Spacing.four },
    sheetTitle: { fontSize: 24, fontWeight: '900', marginBottom: Spacing.four },
    inputLabel: { fontWeight: '600', marginBottom: Spacing.one },
    input: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three, fontSize: 16, marginBottom: Spacing.four },

    // Package Actions
    actionsContainer: { marginBottom: Spacing.four },
    sectionSubtitle: { fontSize: 18, fontWeight: '700', marginBottom: Spacing.three },
    actionButtonsRow: { flexDirection: 'row', gap: Spacing.three },
    actionButton: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, borderRadius: Spacing.two },
    actionButtonText: { fontWeight: '700', fontSize: 16 },

    // Save
    saveButton: { paddingVertical: Spacing.three, borderRadius: Spacing.two, alignItems: 'center', marginTop: 'auto', marginBottom: Spacing.six },
    saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 18 },
});