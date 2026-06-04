// src/app/index.tsx
import { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetModal, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { CalendarProvider, WeekCalendar } from 'react-native-calendars';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

dayjs.extend(customParseFormat);

// --- Mock Data ---
const MOCK_CLASSES = [
  { id: '1', time: '5:00 PM', title: 'Kids Boxing', type: 'Group' },
  { id: '2', time: '6:00 PM', title: 'Adult Group Boxing', type: 'Group' },
  { id: '3', time: '7:15 PM', title: 'John D.', type: 'Personal Training', clientId: '1' },
];

const MOCK_CLIENTS = [
  { id: '1', name: 'John Doe' },
  { id: '2', name: 'Jane Smith' },
  { id: '3', name: 'Mike Tyson' },
];

export default function HomeScreen() {
  const theme = useTheme();
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));

  // --- Bottom Sheet State ---
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['70%'], []);

  const [editingSession, setEditingSession] = useState<typeof MOCK_CLASSES[0] | null>(null);
  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<{ id: string, name: string } | null>(null);
  const [sessionTime, setSessionTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  // --- Backdrop Config ---
  // This adds the dark, clickable overlay behind the bottom sheet
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  );

  const filteredClients = useMemo(() => {
    if (!clientQuery || selectedClient) return [];
    return MOCK_CLIENTS.filter(client =>
      client.name.toLowerCase().includes(clientQuery.toLowerCase())
    );
  }, [clientQuery, selectedClient]);

  // --- Handlers ---
  const handleAddSession = () => {
    setEditingSession(null);
    setClientQuery('');
    setSelectedClient(null);
    setSessionTime(new Date());
    bottomSheetModalRef.current?.present();
  };

  const handleEditSession = (session: typeof MOCK_CLASSES[0]) => {
    setEditingSession(session);
    setClientQuery(session.title);

    const clientMatch = MOCK_CLIENTS.find(c => c.id === session.clientId);
    if (clientMatch) setSelectedClient(clientMatch);

    const parsedDate = dayjs(`${selectedDate} ${session.time}`, 'YYYY-MM-DD h:mm A').toDate();
    setSessionTime(parsedDate);

    bottomSheetModalRef.current?.present();
  };

  const closeBottomSheet = () => {
    bottomSheetModalRef.current?.dismiss();
  };

  const handleTimeChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedDate) setSessionTime(selectedDate);
  };

  const handleSelectClient = (client: { id: string, name: string }) => {
    setSelectedClient(client);
    setClientQuery(client.name);
    Keyboard.dismiss();
  };

  const handleSave = () => {
    const formattedTime = dayjs(sessionTime).format('h:mm A');

    if (editingSession) {
      console.log('UPDATED Session:', { id: editingSession.id, client: clientQuery, time: formattedTime });
    } else {
      console.log('CREATED Session:', { client: clientQuery, time: formattedTime });
    }
    closeBottomSheet();
  };

  // Note: Updated to accept the session directly so it can be called from the swipe action
  const handleDelete = (session: typeof MOCK_CLASSES[0]) => {
    Alert.alert(
      "Cancel Session",
      `Are you sure you want to remove this session with ${session.title}?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Delete", style: "destructive", onPress: () => {
            console.log('DELETED Session:', session.id);
            closeBottomSheet();
          }
        }
      ]
    );
  };

  // --- Renderers ---

  // The red trash button revealed when swiping left
  const renderRightActions = (item: typeof MOCK_CLASSES[0]) => (
    <TouchableOpacity
      style={[styles.deleteSwipeAction, { backgroundColor: theme.primary }]}
      onPress={() => handleDelete(item)}
      activeOpacity={0.8}
    >
      <SymbolView name="trash.fill" size={24} tintColor="#FFFFFF" />
    </TouchableOpacity>
  );

  const renderClassItem = ({ item }: { item: typeof MOCK_CLASSES[0] }) => (
    <View style={styles.classCardWrapper}>
      <Swipeable renderRightActions={() => renderRightActions(item)}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleEditSession(item)}
        >
          <ThemedView type="surface" style={styles.classCard}>
            <View style={[styles.timeContainer, { borderRightColor: theme.primary }]}>
              <ThemedText style={styles.timeText}>{item.time}</ThemedText>
            </View>
            <View style={styles.detailsContainer}>
              <ThemedText style={styles.classTitle}>{item.title}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">{item.type}</ThemedText>
            </View>
          </ThemedView>
        </TouchableOpacity>
      </Swipeable>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
          <ThemedText style={styles.headerTitle}>Gonza Boxing Union</ThemedText>
        </View>

        {/* Sleek Week View */}
        <View style={[styles.calendarContainer, { backgroundColor: theme.background }]}>
          <CalendarProvider
            date={selectedDate}
            onDateChanged={(date) => setSelectedDate(date)}
            style={{ backgroundColor: theme.background }}
          >
            <WeekCalendar
              key={theme.background}
              firstDay={1}
              allowShadow={false}
              markedDates={{
                [selectedDate]: { selected: true, selectedColor: theme.primary },
              }}
              style={{ backgroundColor: theme.background }}
              theme={{
                calendarBackground: theme.background,
                backgroundColor: theme.background,
                selectedDayBackgroundColor: theme.primary,
                selectedDayTextColor: '#FFFFFF',
                todayTextColor: theme.primary,
                dayTextColor: theme.text,
                textDisabledColor: theme.backgroundElement,
                monthTextColor: theme.text,
                textSectionTitleColor: theme.textSecondary,
                textDayHeaderFontWeight: '600',
              }}
            />
          </CalendarProvider>
        </View>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: theme.backgroundElement }]} />

        {/* Classes List */}
        <View style={styles.listContainer}>
          <ThemedText style={styles.listHeader}>
            {dayjs(selectedDate).format('dddd, MMMM D')}
          </ThemedText>

          <FlatList
            data={MOCK_CLASSES}
            keyExtractor={(item) => item.id}
            renderItem={renderClassItem}
            contentContainerStyle={styles.flatListContent}
            showsVerticalScrollIndicator={false}
          />
        </View>

        {/* FAB for Adding */}
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.primary }]}
          activeOpacity={0.8}
          onPress={handleAddSession}
        >
          <SymbolView name="plus" size={32} tintColor="#FFFFFF" weight="bold" />
        </TouchableOpacity>

      </SafeAreaView>

      {/* Unified Add/Edit Bottom Sheet Modal */}
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
            {editingSession ? 'Edit Session' : 'Add PT Session'}
          </ThemedText>

          {/* Autocomplete Client Input */}
          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Client Name</ThemedText>
          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
            placeholder="Search or add new client..."
            placeholderTextColor={theme.textSecondary}
            value={clientQuery}
            onChangeText={(text) => {
              setClientQuery(text);
              setSelectedClient(null);
            }}
          />

          {/* Autocomplete Results Dropdown */}
          {filteredClients.length > 0 && (
            <View style={[styles.autocompleteContainer, { backgroundColor: theme.surface, borderColor: theme.backgroundElement }]}>
              <BottomSheetFlatList
                data={filteredClients}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.autocompleteItem, { borderBottomColor: theme.backgroundElement }]}
                    onPress={() => handleSelectClient(item)}
                  >
                    <ThemedText style={styles.autocompleteText}>{item.name}</ThemedText>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Time Selector Button */}
          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Session Time</ThemedText>
          <TouchableOpacity
            style={[styles.timeSelectorButton, { borderColor: theme.surface, backgroundColor: theme.background }]}
            activeOpacity={0.7}
            onPress={() => setShowTimePicker(true)}
          >
            <ThemedText style={styles.timeSelectorText}>
              {dayjs(sessionTime).format('h:mm A')}
            </ThemedText>
          </TouchableOpacity>

          {/* Native Time Picker */}
          {showTimePicker && (
            <DateTimePicker
              value={sessionTime}
              mode="time"
              display="spinner"
              minuteInterval={15}
              onChange={handleTimeChange}
              textColor={theme.text}
            />
          )}

          {/* Action Buttons */}
          <View style={[styles.actionRow, { marginTop: showTimePicker ? Spacing.two : Spacing.four }]}>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: theme.primary, flex: 1 }]}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.saveButtonText}>
                {editingSession ? 'Update Session' : 'Save Session'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Delete Button (Only visible in Edit mode) */}
          {editingSession && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDelete(editingSession)}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.deleteButtonText, { color: theme.primary }]}>
                Cancel Session
              </ThemedText>
            </TouchableOpacity>
          )}

        </BottomSheetView>
      </BottomSheetModal>
    </ThemedView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderBottomWidth: 1 },
  headerTitle: { fontSize: 22, fontWeight: '900', textTransform: 'uppercase' },
  calendarContainer: { height: 85 },
  divider: { height: 1, marginVertical: Spacing.two },
  listContainer: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  listHeader: { fontSize: 18, fontWeight: '700', marginBottom: Spacing.three },
  flatListContent: { paddingBottom: 100 },

  // --- Class Card & Swipe Styles ---
  classCardWrapper: {
    marginBottom: Spacing.three, // Moved margin here so swipe action matches height perfectly
  },
  classCard: { flexDirection: 'row', borderRadius: Spacing.two, padding: Spacing.three, alignItems: 'center' },
  timeContainer: { width: 80, borderRightWidth: 2, marginRight: Spacing.three },
  timeText: { fontSize: 16, fontWeight: '800' },
  detailsContainer: { flex: 1 },
  classTitle: { fontSize: 16, fontWeight: '700', marginBottom: Spacing.half },

  deleteSwipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: Spacing.two,
    marginLeft: Spacing.two, // Give it a little gap from the main card
  },

  // --- FAB Styles ---
  fab: { position: 'absolute', bottom: Spacing.four, right: Spacing.four, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6 },

  // --- Bottom Sheet Styles ---
  sheetContent: { flex: 1, padding: Spacing.four },
  sheetTitle: { fontSize: 22, fontWeight: '800', marginBottom: Spacing.four },
  inputLabel: { fontWeight: '600', marginBottom: Spacing.one },
  input: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three, fontSize: 16, marginBottom: Spacing.three },

  autocompleteContainer: { maxHeight: 150, borderWidth: 1, borderRadius: Spacing.two, marginTop: -Spacing.two, marginBottom: Spacing.three, overflow: 'hidden' },
  autocompleteItem: { padding: Spacing.three, borderBottomWidth: 1 },
  autocompleteText: { fontSize: 16, fontWeight: '500' },

  timeSelectorButton: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.three, justifyContent: 'center' },
  timeSelectorText: { fontSize: 16, fontWeight: '500' },

  actionRow: { flexDirection: 'row', gap: Spacing.three },
  saveButton: { paddingVertical: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },

  deleteButton: { paddingVertical: Spacing.three, marginTop: Spacing.two, alignItems: 'center' },
  deleteButtonText: { fontWeight: '700', fontSize: 16 },
});