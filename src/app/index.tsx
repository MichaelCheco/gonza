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

const MOCK_CLASSES = [
  { id: '1', time: '6:00 AM', title: 'Boxing class', type: 'Group' },
  { id: '2', time: '9:00 AM', title: 'Michael Checo', type: 'Personal Training', clientId: '1' },
  { id: '3', time: '11:00 AM', title: 'Dmitry Bivol', type: 'Personal Training', clientId: '1' },
  { id: '4', time: '5:00 PM', title: 'Kids Boxing', type: 'Group' },
  { id: '5', time: '7:00 PM', title: 'Boxing class', type: 'Group' },
];

const MOCK_CLIENTS = [{ id: '1', name: 'John Doe' }, { id: '2', name: 'Jane Smith' }, { id: '3', name: 'Mike Tyson' }];
const MOCK_ROSTER = [{ id: '1', name: 'John Doe', status: 'paid', checkedIn: false }, { id: '2', name: 'Jane Smith', status: 'unpaid', checkedIn: false }, { id: '4', name: 'Apollo Creed', status: 'paid', checkedIn: true }];

export default function HomeScreen() {
  const theme = useTheme();
  const todayString = dayjs().format('YYYY-MM-DD');
  const [selectedDate, setSelectedDate] = useState(todayString);

  const editSheetRef = useRef<BottomSheetModal>(null);
  const rosterSheetRef = useRef<BottomSheetModal>(null);
  const editSnapPoints = useMemo(() => ['60%'], []);
  const rosterSnapPoints = useMemo(() => ['75%'], []);

  const [editingSession, setEditingSession] = useState<typeof MOCK_CLASSES[0] | null>(null);
  const [selectedGroupClass, setSelectedGroupClass] = useState<typeof MOCK_CLASSES[0] | null>(null);

  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<{ id: string, name: string } | null>(null);
  const [sessionTime, setSessionTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [rosterData, setRosterData] = useState(MOCK_ROSTER);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []
  );

  const filteredClients = useMemo(() => {
    if (!clientQuery || selectedClient) return [];
    return MOCK_CLIENTS.filter(c => c.name.toLowerCase().includes(clientQuery.toLowerCase()));
  }, [clientQuery, selectedClient]);

  const filteredRoster = useMemo(() => {
    if (!rosterSearchQuery) return rosterData;
    return rosterData.filter(c => c.name.toLowerCase().includes(rosterSearchQuery.toLowerCase()));
  }, [rosterSearchQuery, rosterData]);

  const handleCardPress = (session: typeof MOCK_CLASSES[0]) => {
    if (session.type === 'Group') {
      setSelectedGroupClass(session); setRosterSearchQuery(''); rosterSheetRef.current?.present();
    } else {
      handlePTCheckIn(session);
    }
  };

  const handlePTCheckIn = (session: typeof MOCK_CLASSES[0]) => Alert.alert("Checked In", `${session.title} has been checked in.`);
  const toggleRosterCheckIn = (id: string) => setRosterData(curr => curr.map(c => c.id === id ? { ...c, checkedIn: !c.checkedIn } : c));

  const handleAddSession = () => {
    setEditingSession(null); setClientQuery(''); setSelectedClient(null); setSessionTime(new Date()); editSheetRef.current?.present();
  };

  const handleLongPressEdit = (session: typeof MOCK_CLASSES[0]) => {
    setEditingSession(session); setClientQuery(session.title);
    const clientMatch = MOCK_CLIENTS.find(c => c.id === session.clientId);
    if (clientMatch) setSelectedClient(clientMatch);
    setSessionTime(dayjs(`${selectedDate} ${session.time}`, 'YYYY-MM-DD h:mm A').toDate());
    editSheetRef.current?.present();
  };

  const closeEditSheet = () => editSheetRef.current?.dismiss();
  const handleSave = () => closeEditSheet();
  const handleDelete = (session: typeof MOCK_CLASSES[0]) => {
    Alert.alert("Cancel Session", `Remove ${session.title}?`, [{ text: "No", style: "cancel" }, { text: "Yes, Delete", style: "destructive", onPress: () => closeEditSheet() }]);
  };

  const renderLeftActions = (item: typeof MOCK_CLASSES[0]) => {
    if (item.type === 'Group') return null;
    return (
      <TouchableOpacity style={[styles.swipeAction, { backgroundColor: '#28A745', marginRight: Spacing.two }]} onPress={() => handlePTCheckIn(item)} activeOpacity={0.8}>
        <SymbolView name="checkmark.circle.fill" size={22} tintColor="#FFFFFF" />
      </TouchableOpacity>
    );
  };

  const renderRightActions = (item: typeof MOCK_CLASSES[0]) => (
    <TouchableOpacity style={[styles.swipeAction, { backgroundColor: theme.primary, marginLeft: Spacing.two }]} onPress={() => handleDelete(item)} activeOpacity={0.8}>
      <SymbolView name="trash.fill" size={20} tintColor="#FFFFFF" />
    </TouchableOpacity>
  );

  const renderClassItem = ({ item }: { item: typeof MOCK_CLASSES[0] }) => {
    const isPT = item.type !== 'Group';
    return (
      <View style={styles.classCardWrapper}>
        <Swipeable renderLeftActions={() => renderLeftActions(item)} renderRightActions={() => renderRightActions(item)} friction={2}>
          <TouchableOpacity activeOpacity={0.8} onPress={() => handleCardPress(item)} onLongPress={() => handleLongPressEdit(item)}>
            <ThemedView type="surface" style={styles.classCard}>
              <View style={[styles.timeContainer, { borderRightColor: theme.textSecondary }]}>
                <ThemedText style={styles.timeText}>{item.time}</ThemedText>
              </View>
              <View style={styles.detailsContainer}>
                <ThemedText style={styles.classTitle}>{item.title}</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">{item.type}</ThemedText>
              </View>
              <View style={styles.cardActionContainer}>
                {isPT ? (
                  <TouchableOpacity style={[styles.inlineCheckInBtn, { backgroundColor: theme.backgroundElement }]} onPress={() => handlePTCheckIn(item)}>
                    <ThemedText style={[styles.inlineCheckInText, { color: theme.text }]}>Check In</ThemedText>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.rosterChevron}>
                    <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
                  </View>
                )}
              </View>
            </ThemedView>
          </TouchableOpacity>
        </Swipeable>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
          <ThemedText style={styles.headerTitle}>Gonza Boxing</ThemedText>
          {selectedDate !== todayString && (
            <TouchableOpacity style={[styles.todayButton, { backgroundColor: theme.surface }]} onPress={() => setSelectedDate(todayString)}>
              <ThemedText type="smallBold">Today</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.calendarContainer, { backgroundColor: theme.background }]}>
          <CalendarProvider date={selectedDate} onDateChanged={(date) => setSelectedDate(date)} style={{ backgroundColor: theme.background }}>
            <WeekCalendar
              key={theme.background} firstDay={1} allowShadow={false}
              markedDates={{ [selectedDate]: { selected: true, selectedColor: theme.primary } }}
              style={{ backgroundColor: theme.background }}
              theme={{
                calendarBackground: theme.background, backgroundColor: theme.background, selectedDayBackgroundColor: theme.primary,
                selectedDayTextColor: '#FFFFFF', todayTextColor: theme.primary, dayTextColor: theme.text,
                textDisabledColor: theme.backgroundElement, monthTextColor: theme.text, textSectionTitleColor: theme.textSecondary,
              }}
            />
          </CalendarProvider>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.backgroundElement }]} />

        <View style={styles.listContainer}>
          <ThemedText style={styles.listHeader}>{dayjs(selectedDate).format('dddd, MMMM D')}</ThemedText>
          <FlatList
            data={MOCK_CLASSES} keyExtractor={(item) => item.id} renderItem={renderClassItem}
            contentContainerStyle={styles.flatListContent} showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <TouchableOpacity activeOpacity={0.7} onPress={handleAddSession} style={styles.emptyState}>
                <SymbolView name="calendar.badge.plus" size={40} tintColor={theme.textSecondary} style={{ marginBottom: Spacing.two }} />
                <ThemedText themeColor="textSecondary" style={styles.emptyText}>No sessions scheduled.{"\n"}Tap to add one.</ThemedText>
              </TouchableOpacity>
            }
          />
        </View>

        <TouchableOpacity style={[styles.fab, { backgroundColor: theme.primary }]} activeOpacity={0.8} onPress={handleAddSession}>
          <SymbolView name="plus" size={24} tintColor="#FFFFFF" weight="bold" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* 1. Add / Edit Session Modal */}
      <BottomSheetModal ref={editSheetRef} index={0} snapPoints={editSnapPoints} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.backgroundElement }} handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}>
        <BottomSheetView style={styles.sheetContent}>
          <ThemedText style={styles.sheetTitle}>{editingSession ? 'Edit Session' : 'Add PT Session'}</ThemedText>

          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Client Name</ThemedText>
          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
            placeholder="Search or add new..." placeholderTextColor={theme.textSecondary}
            value={clientQuery} onChangeText={(text) => { setClientQuery(text); setSelectedClient(null); }}
          />

          {filteredClients.length > 0 && (
            <View style={[styles.autocompleteContainer, { backgroundColor: theme.surface, borderColor: theme.backgroundElement }]}>
              <BottomSheetFlatList
                data={filteredClients} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={[styles.autocompleteItem, { borderBottomColor: theme.backgroundElement }]} onPress={() => { setSelectedClient(item); setClientQuery(item.name); Keyboard.dismiss(); }}>
                    <ThemedText style={{ fontSize: 15 }}>{item.name}</ThemedText>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Session Time</ThemedText>
          <TouchableOpacity style={[styles.timeSelectorButton, { borderColor: theme.surface, backgroundColor: theme.background }]} onPress={() => setShowTimePicker(true)}>
            <ThemedText style={{ fontSize: 15 }}>{dayjs(sessionTime).format('h:mm A')}</ThemedText>
          </TouchableOpacity>
          {showTimePicker && (
            <DateTimePicker value={sessionTime} mode="time" display="spinner" minuteInterval={15} onChange={(e, date) => { if (Platform.OS === 'android') setShowTimePicker(false); if (date) setSessionTime(date); }} textColor={theme.text} />
          )}

          <View style={[styles.actionRow, { marginTop: showTimePicker ? Spacing.two : Spacing.four }]}>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: theme.primary, flex: 1 }]} onPress={handleSave}>
              <ThemedText style={styles.saveButtonText}>{editingSession ? 'Update' : 'Save'}</ThemedText>
            </TouchableOpacity>
          </View>
        </BottomSheetView>
      </BottomSheetModal>

      {/* 2. Group Class Roster Modal */}
      <BottomSheetModal ref={rosterSheetRef} index={0} snapPoints={rosterSnapPoints} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.backgroundElement }} handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}>
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.rosterHeader}>
            <ThemedText style={styles.sheetTitle}>{selectedGroupClass?.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{selectedGroupClass?.time} • Roster</ThemedText>
          </View>

          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background, marginBottom: Spacing.three }]}
            placeholder="Search roster..." placeholderTextColor={theme.textSecondary}
            value={rosterSearchQuery} onChangeText={setRosterSearchQuery} clearButtonMode="while-editing"
          />

          <BottomSheetFlatList
            data={filteredRoster} keyExtractor={item => item.id} contentContainerStyle={{ paddingBottom: Spacing.six }}
            ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ textAlign: 'center', marginTop: Spacing.four }}>No matches found.</ThemedText>}
            renderItem={({ item }) => (
              <View style={[styles.rosterRow, { borderBottomColor: theme.surface }]}>
                <View>
                  <ThemedText style={[styles.rosterName, item.status === 'unpaid' && { color: theme.primary }]}>{item.name}</ThemedText>
                  {item.status === 'unpaid' && <ThemedText type="smallBold" style={{ color: theme.primary }}>Unpaid</ThemedText>}
                </View>
                <TouchableOpacity style={[styles.rosterCheckInBtn, { backgroundColor: item.checkedIn ? '#28A745' : theme.surface }]} onPress={() => toggleRosterCheckIn(item.id)}>
                  <ThemedText style={[styles.rosterCheckInText, item.checkedIn && { color: '#FFF' }]}>{item.checkedIn ? 'Checked In' : 'Check In'}</ThemedText>
                </TouchableOpacity>
              </View>
            )}
          />
        </BottomSheetView>
      </BottomSheetModal>

    </ThemedView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1 }, safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', textTransform: 'uppercase' },
  todayButton: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Spacing.two },
  calendarContainer: { height: 85 }, divider: { height: 1, marginVertical: Spacing.one },
  listContainer: { flex: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  listHeader: { fontSize: 16, fontWeight: '700', marginBottom: Spacing.two },
  flatListContent: { paddingBottom: 100, flexGrow: 1 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 40 },
  emptyText: { textAlign: 'center', fontSize: 15, fontWeight: '500', lineHeight: 22 },

  classCardWrapper: { marginBottom: Spacing.two },
  classCard: { flexDirection: 'row', borderRadius: Spacing.two, padding: 12, alignItems: 'center' },
  timeContainer: { width: 70, borderRightWidth: 1, marginRight: Spacing.three },
  timeText: { fontSize: 15, fontWeight: '700' },
  detailsContainer: { flex: 1 },
  classTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },

  cardActionContainer: { justifyContent: 'center', alignItems: 'flex-end', minWidth: 60 },
  inlineCheckInBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Spacing.two },
  inlineCheckInText: { fontWeight: '600', fontSize: 13 },
  rosterChevron: { flexDirection: 'row', alignItems: 'center' },
  swipeAction: { justifyContent: 'center', alignItems: 'center', width: 70, borderRadius: Spacing.two },

  fab: { position: 'absolute', bottom: Spacing.four, right: Spacing.four, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },

  sheetContent: { flex: 1, padding: Spacing.four, paddingTop: Spacing.two },
  sheetTitle: { fontSize: 20, fontWeight: '800', marginBottom: Spacing.three },
  inputLabel: { fontWeight: '600', marginBottom: 6, fontSize: 13 },
  input: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, fontSize: 15, marginBottom: Spacing.three },

  autocompleteContainer: { maxHeight: 150, borderWidth: 1, borderRadius: Spacing.two, marginTop: -8, marginBottom: Spacing.three, overflow: 'hidden' },
  autocompleteItem: { padding: 12, borderBottomWidth: 1 },
  timeSelectorButton: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, marginBottom: Spacing.three, justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  saveButton: { paddingVertical: 14, borderRadius: Spacing.two, alignItems: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },

  rosterHeader: { marginBottom: Spacing.three },
  rosterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  rosterName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  rosterCheckInBtn: { paddingHorizontal: Spacing.three, paddingVertical: 8, borderRadius: Spacing.two },
  rosterCheckInText: { fontWeight: '700', fontSize: 13 },
});