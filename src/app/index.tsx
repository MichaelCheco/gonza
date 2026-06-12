import { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetModal, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { CalendarProvider, WeekCalendar } from 'react-native-calendars';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/providers/auth-provider';
import { supabase } from '../../utils/supabase';

dayjs.extend(customParseFormat);

// Define our session type now that we aren't relying on typeof MOCK_CLASSES
type SessionType = {
  id: string;
  time: string;
  title: string;
  type: string;
  clientId?: string;
  checkedIn?: boolean;
};

type CheckInState = {
  status: 'loading' | 'success' | 'error';
  message?: string;
};

type SessionMode = 'Group' | 'Personal Training';

type AttendanceRow = {
  id: number;
  client_id: number;
  client_package_id: number | null;
};

export default function HomeScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const todayString = dayjs().format('YYYY-MM-DD');
  const [selectedDate, setSelectedDate] = useState(todayString);

  const editSheetRef = useRef<BottomSheetModal>(null);
  const rosterSheetRef = useRef<BottomSheetModal>(null);
  const editSnapPoints = useMemo(() => ['60%'], []);
  const rosterSnapPoints = useMemo(() => ['75%'], []);

  // --- Roster State ---
  const [rosterData, setRosterData] = useState<any[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');

  // For adding walk-ins to the roster
  const [addWalkInQuery, setAddWalkInQuery] = useState('');
  // --- Real Database State ---
  const [classes, setClasses] = useState<SessionType[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ptCheckInStates, setPtCheckInStates] = useState<Record<string, CheckInState>>({});

  const [editingSession, setEditingSession] = useState<SessionType | null>(null);
  const [selectedGroupClass, setSelectedGroupClass] = useState<SessionType | null>(null);

  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<{ id: string, name: string } | null>(null);
  const [sessionMode, setSessionMode] = useState<SessionMode>('Group');
  const [sessionTime, setSessionTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []
  );

  // --- Fetch Roster for a specific class ---
  const fetchRoster = async (classId: string) => {
    setRosterLoading(true);
    const { data, error } = await supabase
      .from('attendance')
      .select(`
        id,
        client_id,
        client_package_id,
        clients ( id, first_name, last_name )
      `)
      .eq('class_id', classId);

    if (error) {
      Alert.alert("Error fetching roster", error.message);
    } else if (data) {
      const formattedRoster = data.map(att => {
        const clientData = att.clients as any;
        return {
          id: att.id.toString(), // The attendance record ID
          clientId: att.client_id.toString(),
          name: `${clientData.first_name} ${clientData.last_name}`,
          // If they have a package ID linked to this attendance, they are checked in
          checkedIn: !!att.client_package_id,
        };
      });
      setRosterData(formattedRoster);
    }
    setRosterLoading(false);
  };

  // --- Add Walk-in to Roster ---
  const handleAddWalkIn = async (client: any) => {
    if (!selectedGroupClass) return;

    const { error } = await supabase.from('attendance').insert({
      class_id: selectedGroupClass.id,
      client_id: client.id
    });

    if (error) {
      Alert.alert("Error", "Could not add client to roster.");
    } else {
      setAddWalkInQuery('');
      Keyboard.dismiss();
      fetchRoster(selectedGroupClass.id); // Refresh the roster
    }
  };

  // --- 1. Fetch Clients for Autocomplete (Runs once) ---
  useEffect(() => {
    const fetchClients = async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, first_name, last_name')
        .order('first_name');

      if (!error && data) {
        setClients(data.map(c => ({
          id: c.id.toString(),
          name: `${c.first_name} ${c.last_name}`.trim()
        })));
      }
    };
    fetchClients();
  }, []);

  // --- 2. Fetch Classes dynamically when selectedDate changes ---
  const fetchClasses = useCallback(async () => {
    setLoading(true);
    const { error: templateError } = await supabase.rpc('generate_classes_from_templates', {
      p_start_date: dayjs(selectedDate).subtract(14, 'day').format('YYYY-MM-DD'),
      p_end_date: dayjs(selectedDate).add(14, 'day').format('YYYY-MM-DD'),
    });

    if (templateError) {
      console.error('Template Schedule Error:', templateError.message);
    }

    const { data, error } = await supabase
      .from('classes')
      .select(`
        id,
        title,
        class_type,
        start_time,
        attendance (
          client_package_id,
          client_id,
          clients (id, first_name, last_name)
        )
      `)
      .eq('scheduled_date', selectedDate)
      .order('start_time', { ascending: true });

    if (error) {
      Alert.alert("Error fetching schedule", error.message);
    } else if (data) {
      const formatted = data.map(c => {
        const isPT = c.class_type === 'Personal Training';
        // Pluck the client data out of the attendance join
        const firstAttendee = c.attendance?.[0]?.clients as any;

        return {
          id: c.id.toString(),
          time: dayjs(`${selectedDate}T${c.start_time}`).format('h:mm A'),
          title: isPT && firstAttendee ? `${firstAttendee.first_name} ${firstAttendee.last_name}` : c.title,
          type: c.class_type,
          clientId: firstAttendee?.id?.toString(),
          checkedIn: !!c.attendance?.[0]?.client_package_id
        };
      });
      setClasses(formatted);
      setPtCheckInStates({});
    }
    setLoading(false);
  }, [selectedDate]);

  // Re-fetch whenever the calendar date is tapped
  useEffect(() => {
    const timeoutId = setTimeout(fetchClasses, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchClasses]);

  const filteredClients = useMemo(() => {
    if (sessionMode !== 'Personal Training' || !clientQuery || selectedClient) return [];
    return clients.filter(c => c.name.toLowerCase().includes(clientQuery.toLowerCase()));
  }, [clientQuery, selectedClient, clients, sessionMode]);

  const filteredRoster = useMemo(() => {
    if (!rosterSearchQuery) return rosterData;
    return rosterData.filter(c => c.name.toLowerCase().includes(rosterSearchQuery.toLowerCase()));
  }, [rosterSearchQuery, rosterData]);

  // --- Action Handlers ---
  const handleCardPress = (session: SessionType) => {
    const isCheckedIn = session.checkedIn || ptCheckInStates[session.id]?.status === 'success';

    if (session.type === 'Group') {
      setSelectedGroupClass(session);
      setRosterSearchQuery('');
      setAddWalkInQuery('');
      fetchRoster(session.id); // <-- Fetch real data
      rosterSheetRef.current?.present();
    } else if (isCheckedIn) {
      handlePTUndoCheckIn(session);
    } else {
      handlePTCheckIn(session);
    }
  };

  const toggleRosterCheckIn = async (rosterItem: any) => {
    if (!selectedGroupClass) return;

    if (rosterItem.checkedIn) {
      return Alert.alert('Undo Check-In', `Restore one credit for ${rosterItem.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: async () => {
            const { data: success, error } = await supabase.rpc('undo_check_in', {
              p_class_id: parseInt(selectedGroupClass.id),
              p_client_id: parseInt(rosterItem.clientId),
            });

            if (error) {
              Alert.alert('Undo Failed', 'Could not undo this check-in. Please try again.');
            } else if (success) {
              fetchRoster(selectedGroupClass.id);
            }
          },
        },
      ]);
    }

    // Call the RPC we made earlier!
    const { data: success, error } = await supabase.rpc('process_check_in', {
      p_class_id: parseInt(selectedGroupClass.id),
      p_client_id: parseInt(rosterItem.clientId)
    });

    if (error) {
      Alert.alert("Error", error.message);
    } else if (success) {
      fetchRoster(selectedGroupClass.id); // Refresh to show the green "Checked In" status
    } else {
      Alert.alert("Check-in Failed", "This client has no active packages with remaining classes.");
    }
  };

  const handlePTCheckIn = async (session: SessionType) => {
    if (!session.clientId || session.checkedIn || ptCheckInStates[session.id]?.status === 'loading') return;

    setPtCheckInStates(prev => ({
      ...prev,
      [session.id]: { status: 'loading' },
    }));

    const { data: success, error } = await supabase.rpc('process_check_in', {
      p_class_id: parseInt(session.id),
      p_client_id: parseInt(session.clientId)
    });

    if (error) {
      setPtCheckInStates(prev => ({
        ...prev,
        [session.id]: { status: 'error', message: 'Check-in error' },
      }));
    } else if (success) {
      setClasses(prev => prev.map(item => item.id === session.id ? { ...item, checkedIn: true } : item));
      setPtCheckInStates(prev => ({
        ...prev,
        [session.id]: { status: 'success' },
      }));
    } else {
      setPtCheckInStates(prev => ({
        ...prev,
        [session.id]: { status: 'error', message: 'No active package' },
      }));
    }
  };

  const handlePTUndoCheckIn = (session: SessionType) => {
    if (!session.clientId || ptCheckInStates[session.id]?.status === 'loading') return;

    Alert.alert('Undo Check-In', `Restore one credit for ${session.title}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: async () => {
          setPtCheckInStates(prev => ({
            ...prev,
            [session.id]: { status: 'loading' },
          }));

          const { data: success, error } = await supabase.rpc('undo_check_in', {
            p_class_id: parseInt(session.id),
            p_client_id: parseInt(session.clientId!),
          });

          if (error) {
            setPtCheckInStates(prev => ({
              ...prev,
              [session.id]: { status: 'error', message: 'Undo failed' },
            }));
          } else if (success) {
            setClasses(prev => prev.map(item => item.id === session.id ? { ...item, checkedIn: false } : item));
            setPtCheckInStates(prev => {
              const next = { ...prev };
              delete next[session.id];
              return next;
            });
          } else {
            setPtCheckInStates(prev => ({
              ...prev,
              [session.id]: { status: 'error', message: 'Not checked in' },
            }));
          }
        },
      },
    ]);
  };

  const handleAddSession = () => {
    setEditingSession(null);
    setSessionMode('Group');
    setClientQuery('');
    setSelectedClient(null);
    setSessionTime(new Date());
    editSheetRef.current?.present();
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Sign out of the owner account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleLongPressEdit = (session: SessionType) => {
    const nextMode: SessionMode = session.type === 'Personal Training' ? 'Personal Training' : 'Group';
    setEditingSession(session);
    setSessionMode(nextMode);
    setClientQuery(session.title);
    const clientMatch = clients.find(c => c.id === session.clientId);
    setSelectedClient(clientMatch && nextMode === 'Personal Training' ? clientMatch : null);
    setSessionTime(dayjs(`${selectedDate} ${session.time}`, 'YYYY-MM-DD h:mm A').toDate());
    editSheetRef.current?.present();
  };

  const closeEditSheet = () => editSheetRef.current?.dismiss();

  // --- 3. Save to Supabase ---
  const handleSave = async () => {
    const isPT = sessionMode === 'Personal Training';
    const trimmedTitle = clientQuery.trim();

    if (isPT && !selectedClient) {
      return Alert.alert('Client Required', 'Please select a PT client.');
    }

    if (!isPT && !trimmedTitle) {
      return Alert.alert('Title Required', 'Please enter a group class title.');
    }

    const timeString = dayjs(sessionTime).format('HH:mm:ss');

    const classData = {
      title: isPT ? 'PT Session' : trimmedTitle,
      class_type: sessionMode,
      scheduled_date: selectedDate,
      start_time: timeString,
    };

    if (editingSession) {
      const { data: attendanceRows, error: attendanceError } = await supabase
        .from('attendance')
        .select('id, client_id, client_package_id')
        .eq('class_id', editingSession.id);

      if (attendanceError) {
        return Alert.alert('Save Failed', 'Could not verify attendance records. Please try again.');
      }

      const rows = (attendanceRows ?? []) as AttendanceRow[];
      const hasCheckedInAttendance = rows.some((row) => !!row.client_package_id);
      const wasPT = editingSession.type === 'Personal Training';
      const existingPTClientId = rows[0]?.client_id?.toString();

      if (hasCheckedInAttendance && wasPT !== isPT) {
        return Alert.alert('Undo Check-Ins First', 'Undo existing check-ins before changing this session type.');
      }

      if (!wasPT && isPT && rows.length > 0) {
        return Alert.alert('Roster Exists', 'Remove roster clients before converting this group class to PT.');
      }

      if (wasPT && isPT && hasCheckedInAttendance && existingPTClientId !== selectedClient?.id) {
        return Alert.alert('Undo Check-In First', 'Undo the PT check-in before assigning this session to another client.');
      }

      const { error } = await supabase.from('classes').update(classData).eq('id', editingSession.id);
      if (error) return Alert.alert('Update Error', error.message);

      if (isPT && selectedClient) {
        if (rows[0]) {
          const { error: attendanceUpdateError } = await supabase
            .from('attendance')
            .update({ client_id: selectedClient.id })
            .eq('id', rows[0].id);

          if (attendanceUpdateError) return Alert.alert('Attendance Error', 'Could not update the PT client.');
        } else {
          const { error: attendanceInsertError } = await supabase.from('attendance').insert({
            class_id: editingSession.id,
            client_id: selectedClient.id,
          });

          if (attendanceInsertError) return Alert.alert('Attendance Error', 'Could not assign the PT client.');
        }
      } else if (wasPT && !isPT) {
        const { error: attendanceDeleteError } = await supabase.from('attendance').delete().eq('class_id', editingSession.id);

        if (attendanceDeleteError) return Alert.alert('Attendance Error', 'Could not clear the old PT client.');
      }
    } else {
      const { data: newClass, error: classErr } = await supabase.from('classes').insert(classData).select().single();
      if (classErr) return Alert.alert("Insert Error", classErr.message);

      if (isPT && newClass) {
        const { error: attendanceErr } = await supabase.from('attendance').insert({
          class_id: newClass.id,
          client_id: selectedClient!.id,
        });
        if (attendanceErr) Alert.alert("Attendance Error", attendanceErr.message);
      }
    }

    fetchClasses();
    closeEditSheet();
  };

  // --- 4. Delete from Supabase ---
  const handleDelete = (session: SessionType) => {
    Alert.alert("Cancel Session", `Remove ${session.title}? Any checked-in credits will be restored.`, [
      { text: "No", style: "cancel" },
      {
        text: "Cancel Session",
        style: "destructive",
        onPress: async () => {
          const { data: success, error } = await supabase.rpc('cancel_session', {
            p_class_id: parseInt(session.id),
          });

          if (error || !success) Alert.alert("Cancel Failed", "Could not cancel this session. Please try again.");
          else {
            fetchClasses();
            closeEditSheet();
          }
        }
      }
    ]);
  };

  const renderLeftActions = (item: SessionType) => {
    if (item.type === 'Group') return null;
    const isCheckedIn = item.checkedIn || ptCheckInStates[item.id]?.status === 'success';

    if (isCheckedIn) return null;

    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: '#28A745', marginRight: Spacing.two }]}
        onPress={() => handlePTCheckIn(item)}
        activeOpacity={0.8}
      >
        <SymbolView name="checkmark.circle.fill" size={22} tintColor="#FFFFFF" />
      </TouchableOpacity>
    );
  };

  const renderRightActions = (item: SessionType) => (
    <TouchableOpacity style={[styles.swipeAction, { backgroundColor: theme.primary, marginLeft: Spacing.two }]} onPress={() => handleDelete(item)} activeOpacity={0.8}>
      <SymbolView name="trash.fill" size={20} tintColor="#FFFFFF" />
    </TouchableOpacity>
  );

  const renderClassItem = ({ item }: { item: SessionType }) => {
    const isPT = item.type !== 'Group';
    const checkInState = ptCheckInStates[item.id];
    const isCheckingIn = checkInState?.status === 'loading';
    const isCheckedIn = item.checkedIn || checkInState?.status === 'success';
    const checkInError = checkInState?.status === 'error' ? checkInState.message : undefined;

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
              <View style={[styles.cardActionContainer, isPT && isCheckedIn && styles.cardActionContainerBadge]}>
                {isPT ? (
                  <>
                    {isCheckedIn ? (
                      <View
                        style={[styles.ptCheckedBadge, { backgroundColor: theme.backgroundSelected, borderColor: theme.surface }]}
                        accessibilityLabel="Checked in"
                      >
                        <SymbolView name="checkmark" size={12} tintColor={theme.textSecondary} />
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.inlineCheckInBtn,
                          { backgroundColor: theme.backgroundElement },
                          isCheckingIn && styles.inlineCheckInBtnLoading,
                        ]}
                        onPress={() => handlePTCheckIn(item)}
                        activeOpacity={0.7}
                        disabled={isCheckingIn}
                      >
                        {isCheckingIn ? (
                          <ActivityIndicator size="small" color={theme.text} />
                        ) : (
                          <ThemedText style={[styles.inlineCheckInText, { color: theme.text }]}>Check In</ThemedText>
                        )}
                      </TouchableOpacity>
                    )}
                    {checkInError && <ThemedText style={[styles.inlineCheckInError, { color: theme.primary }]}>{checkInError}</ThemedText>}
                  </>
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
          <View style={styles.headerActions}>
            {selectedDate !== todayString && (
              <TouchableOpacity style={[styles.todayButton, { backgroundColor: theme.surface }]} onPress={() => setSelectedDate(todayString)}>
                <ThemedText type="smallBold">Today</ThemedText>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.headerIconButton, { backgroundColor: theme.surface }]} onPress={handleSignOut} activeOpacity={0.8}>
              <SymbolView name="rectangle.portrait.and.arrow.right" size={16} tintColor={theme.textSecondary} />
            </TouchableOpacity>
          </View>
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
            data={classes}
            keyExtractor={(item) => item.id}
            renderItem={renderClassItem}
            contentContainerStyle={styles.flatListContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 40 }} />
              ) : (
                <TouchableOpacity activeOpacity={0.7} onPress={handleAddSession} style={styles.emptyState}>
                  <SymbolView name="calendar.badge.plus" size={40} tintColor={theme.textSecondary} style={{ marginBottom: Spacing.two }} />
                  <ThemedText themeColor="textSecondary" style={styles.emptyText}>No sessions scheduled.{"\n"}Tap to add one.</ThemedText>
                </TouchableOpacity>
              )
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
          <ThemedText style={styles.sheetTitle}>{editingSession ? 'Edit Session' : 'Add Session'}</ThemedText>

          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Session Type</ThemedText>
          <View style={[styles.modeSelector, { backgroundColor: theme.background }]}>
            {(['Group', 'Personal Training'] as SessionMode[]).map((mode) => {
              const isSelected = sessionMode === mode;

              return (
                <TouchableOpacity
                  key={mode}
                  style={[styles.modeOption, { backgroundColor: isSelected ? theme.text : 'transparent' }]}
                  onPress={() => {
                    setSessionMode(mode);
                    setSelectedClient(null);
                    setClientQuery('');
                  }}
                  activeOpacity={0.8}
                >
                  <ThemedText style={[styles.modeOptionText, { color: isSelected ? theme.background : theme.textSecondary }]}>
                    {mode === 'Personal Training' ? 'PT' : 'Group'}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>

          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>
            {sessionMode === 'Personal Training' ? 'Client' : 'Group Title'}
          </ThemedText>
          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
            placeholder={sessionMode === 'Personal Training' ? 'Search clients' : 'Class title'} placeholderTextColor={theme.textSecondary}
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
            <DateTimePicker value={sessionTime} mode="time" display="spinner" minuteInterval={30} onChange={(e, date) => { if (Platform.OS === 'android') setShowTimePicker(false); if (date) setSessionTime(date); }} textColor={theme.text} />
          )}

          <View style={[styles.actionRow, { marginTop: showTimePicker ? Spacing.two : Spacing.four }]}>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: theme.primary, flex: 1 }]} onPress={handleSave}>
              <ThemedText style={styles.saveButtonText}>{editingSession ? 'Update' : 'Save'}</ThemedText>
            </TouchableOpacity>
          </View>
        </BottomSheetView>
      </BottomSheetModal>

      {/* 2. Group Class Roster Modal (Still Mocked) */}
      {/* 2. Group Class Roster Modal */}
      <BottomSheetModal ref={rosterSheetRef} index={0} snapPoints={rosterSnapPoints} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.backgroundElement }} handleIndicatorStyle={{ backgroundColor: theme.textSecondary }}>
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.rosterHeader}>
            <ThemedText style={styles.sheetTitle}>{selectedGroupClass?.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{selectedGroupClass?.time} • Roster</ThemedText>
          </View>

          {/* Add Walk-in Section */}
          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Add to Roster</ThemedText>
          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
            placeholder="Search clients to add..." placeholderTextColor={theme.textSecondary}
            value={addWalkInQuery} onChangeText={setAddWalkInQuery}
          />

          {/* Walk-in Autocomplete */}
          {addWalkInQuery.length > 0 && (
            <View style={[styles.autocompleteContainer, { backgroundColor: theme.surface, borderColor: theme.backgroundElement }]}>
              <BottomSheetFlatList
                data={clients.filter(c => c.name.toLowerCase().includes(addWalkInQuery.toLowerCase()))}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={[styles.autocompleteItem, { borderBottomColor: theme.backgroundElement }]} onPress={() => handleAddWalkIn(item)}>
                    <ThemedText style={{ fontSize: 15 }}>+ Add {item.name}</ThemedText>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: theme.surface, marginVertical: Spacing.three }]} />

          {rosterLoading ? (
            <ActivityIndicator size="small" color={theme.primary} style={{ marginTop: 20 }} />
          ) : (
            <BottomSheetFlatList
              data={filteredRoster}
              keyExtractor={item => item.id}
              contentContainerStyle={{ paddingBottom: Spacing.six }}
              ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ textAlign: 'center', marginTop: Spacing.four }}>Roster is empty.</ThemedText>}
              renderItem={({ item }) => (
                <View style={[styles.rosterRow, { borderBottomColor: theme.surface }]}>
                  <View>
                    <ThemedText style={styles.rosterName}>{item.name}</ThemedText>
                  </View>
                  <TouchableOpacity
                    style={[styles.rosterCheckInBtn, { backgroundColor: item.checkedIn ? theme.backgroundElement : theme.surface }]}
                    onPress={() => toggleRosterCheckIn(item)}
                    activeOpacity={0.7}
                  >
                    {item.checkedIn && <SymbolView name="arrow.uturn.backward" size={13} tintColor={theme.primary} />}
                    <ThemedText style={[styles.rosterCheckInText, { color: item.checkedIn ? theme.primary : theme.text }]}>
                      {item.checkedIn ? 'Undo' : 'Check In'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerIconButton: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
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

  cardActionContainer: { justifyContent: 'center', alignItems: 'flex-end', minWidth: 48 },
  cardActionContainerBadge: { justifyContent: 'flex-start', alignSelf: 'stretch', minWidth: 30 },
  ptCheckedBadge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  inlineCheckInBtn: { minWidth: 86, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Spacing.two, alignItems: 'center' },
  inlineCheckInBtnLoading: { minHeight: 31, justifyContent: 'center' },
  inlineCheckInText: { fontWeight: '600', fontSize: 13 },
  inlineCheckInError: { maxWidth: 110, marginTop: 4, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  rosterChevron: { flexDirection: 'row', alignItems: 'center' },
  swipeAction: { justifyContent: 'center', alignItems: 'center', width: 70, borderRadius: Spacing.two },

  fab: { position: 'absolute', bottom: Spacing.four, right: Spacing.four, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },

  sheetContent: { flex: 1, padding: Spacing.four, paddingTop: Spacing.two },
  sheetTitle: { fontSize: 20, fontWeight: '800', marginBottom: Spacing.three },
  inputLabel: { fontWeight: '600', marginBottom: 6, fontSize: 13 },
  input: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, fontSize: 15, marginBottom: Spacing.three },
  modeSelector: { flexDirection: 'row', borderRadius: 8, padding: 3, marginBottom: Spacing.three },
  modeOption: { flex: 1, minHeight: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  modeOptionText: { fontSize: 13, fontWeight: '800' },

  autocompleteContainer: { maxHeight: 150, borderWidth: 1, borderRadius: Spacing.two, marginTop: -8, marginBottom: Spacing.three, overflow: 'hidden' },
  autocompleteItem: { padding: 12, borderBottomWidth: 1 },
  timeSelectorButton: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, marginBottom: Spacing.three, justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  saveButton: { paddingVertical: 14, borderRadius: Spacing.two, alignItems: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },

  rosterHeader: { marginBottom: Spacing.three },
  rosterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  rosterName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  rosterCheckInBtn: { minWidth: 82, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: Spacing.three, paddingVertical: 8, borderRadius: Spacing.two },
  rosterCheckInText: { fontWeight: '700', fontSize: 13 },
});
