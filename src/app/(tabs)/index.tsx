import { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { AppSymbol } from '@/components/app-symbol';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { CalendarProvider, WeekCalendar } from 'react-native-calendars';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  ClientOption,
  fetchClassesByDate,
  fetchClients,
  fetchRoster,
  gymQueryKeys,
  RosterItem,
  SessionType,
  toClientOption,
} from '@/lib/gym-queries';
import { useAuth } from '@/providers/auth-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/utils/supabase';

dayjs.extend(customParseFormat);

type CheckInState = {
  status: 'loading' | 'success' | 'error';
  message?: string;
};

type AttendanceRow = {
  id: number;
  client_id: number;
  client_package_id: number | null;
};

type AvailableSlotItem = {
  kind: 'available';
  id: string;
  time: string;
  sortTime: number;
  dateTime: string;
};

type ScheduledSessionItem = SessionType & {
  kind: 'session';
  sortTime: number;
};

type ScheduleItem = AvailableSlotItem | ScheduledSessionItem;

const AVAILABLE_SLOT_START_HOUR = 6;
const AVAILABLE_SLOT_END_HOUR = 21;

export default function HomeScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const todayString = dayjs().format('YYYY-MM-DD');
  const [selectedDate, setSelectedDate] = useState(todayString);

  const editSheetRef = useRef<BottomSheetModal>(null);
  const rosterSheetRef = useRef<BottomSheetModal>(null);
  const editSnapPoints = useMemo(() => ['60%'], []);
  const rosterSnapPoints = useMemo(() => ['75%'], []);

  const [rosterSearchQuery, setRosterSearchQuery] = useState('');

  // For adding walk-ins to the roster
  const [addWalkInQuery, setAddWalkInQuery] = useState('');
  const [rosterActionClientId, setRosterActionClientId] = useState<string | null>(null);
  const [creatingRosterClient, setCreatingRosterClient] = useState(false);
  const [ptCheckInStates, setPtCheckInStates] = useState<Record<string, CheckInState>>({});

  const [editingSession, setEditingSession] = useState<SessionType | null>(null);
  const [selectedGroupClass, setSelectedGroupClass] = useState<SessionType | null>(null);

  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
  const [sessionTime, setSessionTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const selectedGroupClassId = selectedGroupClass?.id ?? null;
  const {
    data: clientRecords = [],
    error: clientsError,
    refetch: refetchClients,
  } = useQuery({
    queryKey: gymQueryKeys.clients,
    queryFn: fetchClients,
  });
  const clients = useMemo(() => clientRecords.map(toClientOption), [clientRecords]);
  const {
    data: classes = [],
    error: classesError,
    isLoading: loading,
    refetch: refetchClasses,
  } = useQuery({
    queryKey: gymQueryKeys.classesByDate(selectedDate),
    queryFn: () => fetchClassesByDate(selectedDate),
  });
  const {
    data: rosterData = [],
    error: rosterError,
    isFetching: rosterLoading,
    refetch: refetchRoster,
  } = useQuery({
    queryKey: gymQueryKeys.roster(selectedGroupClassId),
    queryFn: () => fetchRoster(selectedGroupClassId!),
    enabled: !!selectedGroupClassId,
  });

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []
  );
  const bottomSheetKeyboardProps = useMemo(() => ({
    android_keyboardInputMode: 'adjustResize' as const,
    enableBlurKeyboardOnGesture: true,
    enableDynamicSizing: false,
    keyboardBehavior: 'interactive' as const,
    keyboardBlurBehavior: 'restore' as const,
  }), []);

  const refreshScheduleState = useCallback(async (classId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gymQueryKeys.classesByDate(selectedDate) }),
      classId ? queryClient.invalidateQueries({ queryKey: gymQueryKeys.roster(classId) }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: gymQueryKeys.clients }),
    ]);
  }, [queryClient, selectedDate]);

  useEffect(() => {
    if (clientsError) Alert.alert('Error fetching clients', clientsError.message);
  }, [clientsError]);

  useEffect(() => {
    if (classesError) Alert.alert('Error fetching schedule', classesError.message);
  }, [classesError]);

  useEffect(() => {
    if (rosterError) Alert.alert('Error fetching roster', rosterError.message);
  }, [rosterError]);

  useFocusEffect(
    useCallback(() => {
      refetchClients();
      refetchClasses();
      if (selectedGroupClassId) refetchRoster();
    }, [refetchClasses, refetchClients, refetchRoster, selectedGroupClassId])
  );

  // --- Add Walk-in to Roster ---
  const handleAddWalkIn = async (client: ClientOption) => {
    if (!selectedGroupClass || rosterActionClientId) return;

    setRosterActionClientId(client.id);

    const { error } = await supabase.rpc('add_group_roster_check_in', {
      p_class_id: parseInt(selectedGroupClass.id, 10),
      p_client_id: parseInt(client.id, 10),
    });

    setRosterActionClientId(null);

    if (error) {
      Alert.alert('Roster Check-In Failed', error.message);
    } else {
      setAddWalkInQuery('');
      Keyboard.dismiss();
      await refreshScheduleState(selectedGroupClass.id);
    }
  };

  const handleCreateWalkIn = async () => {
    if (!selectedGroupClass || creatingRosterClient) return;

    const trimmedName = addWalkInQuery.trim().replace(/\s+/g, ' ');
    if (!trimmedName) return;

    setCreatingRosterClient(true);

    const { error } = await supabase.rpc('create_client_and_group_check_in', {
      p_class_id: parseInt(selectedGroupClass.id, 10),
      p_full_name: trimmedName,
    });

    setCreatingRosterClient(false);

    if (error) {
      Alert.alert('Walk-In Check-In Failed', error.message);
      return;
    }

    setAddWalkInQuery('');
    Keyboard.dismiss();
    await refreshScheduleState(selectedGroupClass.id);
  };

  const filteredClients = useMemo(() => {
    if (!clientQuery || selectedClient) return [];
    return clients.filter(c => c.name.toLowerCase().includes(clientQuery.toLowerCase()));
  }, [clientQuery, selectedClient, clients]);

  const filteredRoster = useMemo(() => {
    if (!rosterSearchQuery) return rosterData;
    return rosterData.filter(c => c.name.toLowerCase().includes(rosterSearchQuery.toLowerCase()));
  }, [rosterSearchQuery, rosterData]);

  const rosteredClientIds = useMemo(() => new Set(rosterData.map((item) => item.clientId)), [rosterData]);
  const addWalkInName = addWalkInQuery.trim().replace(/\s+/g, ' ');
  const addWalkInNameLower = addWalkInName.toLowerCase();
  const rosterClientMatches = useMemo(() => {
    if (!addWalkInNameLower) return [];

    return clients
      .filter((client) => !rosteredClientIds.has(client.id))
      .filter((client) => client.name.toLowerCase().includes(addWalkInNameLower))
      .slice(0, 8);
  }, [addWalkInNameLower, clients, rosteredClientIds]);
  const hasExactClientMatch = useMemo(() => (
    clients.some((client) => client.name.trim().toLowerCase() === addWalkInNameLower)
  ), [addWalkInNameLower, clients]);
  const canCreateRosterClient = addWalkInName.length > 1 && !hasExactClientMatch;
  const scheduleItems = useMemo<ScheduleItem[]>(() => {
    const scheduledItems = classes.map((session) => {
      const sessionDateTime = dayjs(`${selectedDate} ${session.time}`, 'YYYY-MM-DD h:mm A');

      return {
        ...session,
        kind: 'session' as const,
        sortTime: sessionDateTime.valueOf(),
      };
    });
    const occupiedSlotTimes = new Set(
      scheduledItems.map((session) => dayjs(session.sortTime).format('HH:mm'))
    );
    const availableItems: AvailableSlotItem[] = [];

    for (let hour = AVAILABLE_SLOT_START_HOUR; hour <= AVAILABLE_SLOT_END_HOUR; hour += 1) {
      const slotDateTime = dayjs(selectedDate).hour(hour).minute(0).second(0).millisecond(0);
      const slotKey = slotDateTime.format('HH:mm');

      if (!occupiedSlotTimes.has(slotKey)) {
        availableItems.push({
          kind: 'available',
          id: `available-${selectedDate}-${slotKey}`,
          time: slotDateTime.format('h:mm A'),
          sortTime: slotDateTime.valueOf(),
          dateTime: slotDateTime.toISOString(),
        });
      }
    }

    return [...scheduledItems, ...availableItems].sort((a, b) => a.sortTime - b.sortTime);
  }, [classes, selectedDate]);

  const handleSelectedDateChange = (date: string) => {
    setSelectedDate(date);
    setPtCheckInStates({});
  };

  // --- Action Handlers ---
  const handleCardPress = (session: SessionType) => {
    const isCheckedIn = session.checkedIn || ptCheckInStates[session.id]?.status === 'success';

    if (session.type === 'Group') {
      setSelectedGroupClass(session);
      setRosterSearchQuery('');
      setAddWalkInQuery('');
      rosterSheetRef.current?.present();
    } else if (isCheckedIn) {
      handlePTUndoCheckIn(session);
    } else {
      handlePTCheckIn(session);
    }
  };

  const toggleRosterCheckIn = async (rosterItem: RosterItem) => {
    if (!selectedGroupClass || !rosterItem.checkedIn) return;

    const undoMessage = rosterItem.isUnlimited
      ? `Undo check-in for ${rosterItem.name}?`
      : `Restore one credit for ${rosterItem.name}?`;

    return Alert.alert('Undo Check-In', undoMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: async () => {
          const { data: success, error } = await supabase.rpc('undo_check_in', {
            p_class_id: parseInt(selectedGroupClass.id, 10),
            p_client_id: parseInt(rosterItem.clientId, 10),
          });

          if (error) {
            Alert.alert('Undo Failed', 'Could not undo this check-in. Please try again.');
          } else if (success) {
            await refreshScheduleState(selectedGroupClass.id);
          }
        },
      },
    ]);
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
      setPtCheckInStates(prev => ({
        ...prev,
        [session.id]: { status: 'success' },
      }));
      refreshScheduleState(session.id);
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
            setPtCheckInStates(prev => {
              const next = { ...prev };
              delete next[session.id];
              return next;
            });
            refreshScheduleState(session.id);
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
    setClientQuery('');
    setSelectedClient(null);
    setSessionTime(new Date());
    editSheetRef.current?.present();
  };

  const handleAvailableSlotPress = (slot: AvailableSlotItem) => {
    setEditingSession(null);
    setClientQuery('');
    setSelectedClient(null);
    setShowTimePicker(false);
    setSessionTime(dayjs(slot.dateTime).toDate());
    editSheetRef.current?.present();
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Sign out of the owner account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleLongPressEdit = (session: SessionType) => {
    if (session.type !== 'Personal Training') return;

    setEditingSession(session);
    setClientQuery(session.title);
    const clientMatch = clients.find(c => c.id === session.clientId);
    setSelectedClient(clientMatch ?? null);
    setSessionTime(dayjs(`${selectedDate} ${session.time}`, 'YYYY-MM-DD h:mm A').toDate());
    editSheetRef.current?.present();
  };

  const closeEditSheet = () => editSheetRef.current?.dismiss();

  // --- 3. Save to Supabase ---
  const handleSave = async () => {
    if (!selectedClient) {
      return Alert.alert('Client Required', 'Please select a PT client.');
    }

    const timeString = dayjs(sessionTime).format('HH:mm:ss');

    const classData = {
      title: 'PT Session',
      class_type: 'Personal Training',
      scheduled_date: selectedDate,
      start_time: timeString,
    };

    if (editingSession) {
      if (editingSession.type !== 'Personal Training') {
        return Alert.alert('PT Sessions Only', 'Group classes are managed from class templates.');
      }

      const { data: attendanceRows, error: attendanceError } = await supabase
        .from('attendance')
        .select('id, client_id, client_package_id')
        .eq('class_id', editingSession.id);

      if (attendanceError) {
        return Alert.alert('Save Failed', 'Could not verify attendance records. Please try again.');
      }

      const rows = (attendanceRows ?? []) as AttendanceRow[];
      const hasCheckedInAttendance = rows.some((row) => !!row.client_package_id);
      const existingPTClientId = rows[0]?.client_id?.toString();

      if (hasCheckedInAttendance && existingPTClientId !== selectedClient.id) {
        return Alert.alert('Undo Check-In First', 'Undo the PT check-in before assigning this session to another client.');
      }

      const { error } = await supabase.from('classes').update(classData).eq('id', editingSession.id);
      if (error) return Alert.alert('Update Error', error.message);

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
    } else {
      const { data: newClass, error: classErr } = await supabase.from('classes').insert(classData).select().single();
      if (classErr) return Alert.alert("Insert Error", classErr.message);

      if (newClass) {
        const { error: attendanceErr } = await supabase.from('attendance').insert({
          class_id: newClass.id,
          client_id: selectedClient.id,
        });
        if (attendanceErr) Alert.alert("Attendance Error", attendanceErr.message);
      }
    }

    refreshScheduleState(editingSession?.id);
    closeEditSheet();
  };

  // --- 4. Delete from Supabase ---
  const handleDelete = (session: SessionType) => {
    Alert.alert("Cancel Session", `Remove ${session.title}? Any checked-in finite package credits will be restored.`, [
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
            refreshScheduleState(session.id);
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
        style={[styles.swipeAction, { backgroundColor: theme.success, marginRight: Spacing.two }]}
        onPress={() => handlePTCheckIn(item)}
        activeOpacity={0.8}
      >
        <AppSymbol name="checkmark.circle.fill" size={22} tintColor={theme.onSuccess} />
      </TouchableOpacity>
    );
  };

  const renderRightActions = (item: SessionType) => (
    <TouchableOpacity style={[styles.swipeAction, { backgroundColor: theme.primary, marginLeft: Spacing.two }]} onPress={() => handleDelete(item)} activeOpacity={0.8}>
      <AppSymbol name="trash.fill" size={20} tintColor={theme.onPrimary} />
    </TouchableOpacity>
  );

  const getRosterStatusDisplay = (item: RosterItem) => {
    if (item.status === 'first_class') {
      return { label: 'First class', textColor: theme.success, backgroundColor: theme.backgroundElement };
    }

    if (item.status === 'last_class') {
      return { label: 'Last class', textColor: theme.warning, backgroundColor: theme.backgroundElement };
    }

    if (item.status === 'no_active_package') {
      return { label: 'No active package', textColor: theme.warning, backgroundColor: theme.backgroundElement };
    }

    return { label: 'Checked in', textColor: theme.success, backgroundColor: theme.backgroundElement };
  };

  const getClientPreviewTone = (client: ClientOption) => {
    if (client.groupStatusTone === 'ok') {
      return { textColor: theme.success, backgroundColor: theme.backgroundElement };
    }

    if (client.groupStatusTone === 'last') {
      return { textColor: theme.warning, backgroundColor: theme.backgroundElement };
    }

    return { textColor: theme.warning, backgroundColor: theme.backgroundElement };
  };

  const renderAvailableSlotItem = (item: AvailableSlotItem) => (
    <View style={styles.classCardWrapper}>
      <TouchableOpacity activeOpacity={0.75} onPress={() => handleAvailableSlotPress(item)}>
        <ThemedView
          type="surface"
          style={[
            styles.classCard,
            styles.availableCard,
            { backgroundColor: theme.background, borderColor: theme.backgroundElement },
          ]}
        >
          <View style={[styles.timeContainer, { borderRightColor: theme.backgroundElement }]}>
            <ThemedText numberOfLines={1} style={[styles.timeText, { color: theme.textSecondary }]}>{item.time}</ThemedText>
          </View>
          <View style={styles.detailsContainer}>
            <ThemedText style={[styles.classTitle, { color: theme.success }]}>Available</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">Tap to book PT</ThemedText>
          </View>
          <View style={styles.cardActionContainer}>
            <View
              style={[styles.availableActionBadge, { backgroundColor: theme.backgroundElement }]}
              accessibilityLabel="Book available slot"
            >
              <AppSymbol name="plus" size={14} tintColor={theme.success} weight="bold" />
            </View>
          </View>
        </ThemedView>
      </TouchableOpacity>
    </View>
  );

  const renderClassItem = (item: SessionType) => {
    const isPT = item.type !== 'Group';
    const checkInState = ptCheckInStates[item.id];
    const isCheckingIn = checkInState?.status === 'loading';
    const isCheckedIn = item.checkedIn || checkInState?.status === 'success';
    const checkInError = checkInState?.status === 'error' ? checkInState.message : undefined;
    const sessionSubtitle = isPT ? item.type : null;

    return (
      <View style={styles.classCardWrapper}>
        <Swipeable renderLeftActions={() => renderLeftActions(item)} renderRightActions={() => renderRightActions(item)} friction={2}>
          <TouchableOpacity activeOpacity={0.8} onPress={() => handleCardPress(item)} onLongPress={isPT ? () => handleLongPressEdit(item) : undefined}>
            <ThemedView type="surface" style={styles.classCard}>
              <View style={[styles.timeContainer, { borderRightColor: theme.textSecondary }]}>
                <ThemedText numberOfLines={1} style={styles.timeText}>{item.time}</ThemedText>
              </View>
              <View style={styles.detailsContainer}>
                <ThemedText style={styles.classTitle}>{item.title}</ThemedText>
                {sessionSubtitle && (
                  <ThemedText themeColor="textSecondary" type="small">{sessionSubtitle}</ThemedText>
                )}
              </View>
              <View style={[styles.cardActionContainer, isPT && isCheckedIn && styles.cardActionContainerBadge]}>
                {isPT ? (
                  <>
                    {isCheckedIn ? (
                      <View
                        style={[styles.ptCheckedBadge, { backgroundColor: theme.backgroundSelected, borderColor: theme.surface }]}
                        accessibilityLabel="Checked in"
                      >
                        <AppSymbol name="checkmark" size={12} tintColor={theme.textSecondary} />
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
                    <AppSymbol name="chevron.right" size={14} tintColor={theme.textSecondary} />
                  </View>
                )}
              </View>
            </ThemedView>
          </TouchableOpacity>
        </Swipeable>
      </View>
    );
  };

  const renderScheduleItem = ({ item }: { item: ScheduleItem }) => (
    item.kind === 'available' ? renderAvailableSlotItem(item) : renderClassItem(item)
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
          <ThemedText style={styles.headerTitle}>Gonza Boxing</ThemedText>
          <View style={styles.headerActions}>
            {selectedDate !== todayString && (
              <TouchableOpacity style={[styles.todayButton, { backgroundColor: theme.surface }]} onPress={() => handleSelectedDateChange(todayString)}>
                <ThemedText type="smallBold">Today</ThemedText>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.headerIconButton, { backgroundColor: theme.surface }]} onPress={handleSignOut} activeOpacity={0.8}>
              <AppSymbol name="rectangle.portrait.and.arrow.right" size={16} tintColor={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.calendarContainer, { backgroundColor: theme.background }]}>
          <CalendarProvider date={selectedDate} onDateChanged={handleSelectedDateChange} style={{ backgroundColor: theme.background }}>
            <WeekCalendar
              key={theme.background} firstDay={1} allowShadow={false}
              markedDates={{ [selectedDate]: { selected: true, selectedColor: theme.primary } }}
              style={{ backgroundColor: theme.background }}
              theme={{
                calendarBackground: theme.background, backgroundColor: theme.background, selectedDayBackgroundColor: theme.primary,
                selectedDayTextColor: theme.onPrimary, todayTextColor: theme.primary, dayTextColor: theme.text,
                textDisabledColor: theme.backgroundElement, monthTextColor: theme.text, textSectionTitleColor: theme.textSecondary,
              }}
            />
          </CalendarProvider>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.backgroundElement }]} />

        <View style={styles.listContainer}>
          <ThemedText style={styles.listHeader}>{dayjs(selectedDate).format('dddd, MMMM D')}</ThemedText>
          <FlatList
            data={loading ? [] : scheduleItems}
            keyExtractor={(item) => `${item.kind}-${item.id}`}
            renderItem={renderScheduleItem}
            contentContainerStyle={styles.flatListContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 40 }} />
              ) : (
                <TouchableOpacity activeOpacity={0.7} onPress={handleAddSession} style={styles.emptyState}>
                  <AppSymbol name="calendar.badge.plus" size={40} tintColor={theme.textSecondary} style={{ marginBottom: Spacing.two }} />
                  <ThemedText themeColor="textSecondary" style={styles.emptyText}>No sessions scheduled.{"\n"}Tap to add a PT session.</ThemedText>
                </TouchableOpacity>
              )
            }
          />
        </View>

        <TouchableOpacity style={[styles.fab, { backgroundColor: theme.primary }]} activeOpacity={0.8} onPress={handleAddSession}>
          <AppSymbol name="plus" size={24} tintColor={theme.onPrimary} weight="bold" />
        </TouchableOpacity>
      </SafeAreaView>

      {/* 1. Add / Edit PT Session Modal */}
      <BottomSheetModal ref={editSheetRef} index={0} snapPoints={editSnapPoints} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.backgroundElement }} handleIndicatorStyle={{ backgroundColor: theme.textSecondary }} {...bottomSheetKeyboardProps}>
        <BottomSheetScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ThemedText style={styles.sheetTitle}>{editingSession ? 'Edit PT Session' : 'Add PT Session'}</ThemedText>

          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Client</ThemedText>
          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
            placeholder="Search clients" placeholderTextColor={theme.textSecondary}
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
              <ThemedText style={[styles.saveButtonText, { color: theme.onPrimary }]}>{editingSession ? 'Update PT' : 'Add PT'}</ThemedText>
            </TouchableOpacity>
          </View>
        </BottomSheetScrollView>
      </BottomSheetModal>

      {/* 2. Group Class Roster Modal (Still Mocked) */}
      {/* 2. Group Class Roster Modal */}
      <BottomSheetModal ref={rosterSheetRef} index={0} snapPoints={rosterSnapPoints} backdropComponent={renderBackdrop} backgroundStyle={{ backgroundColor: theme.backgroundElement }} handleIndicatorStyle={{ backgroundColor: theme.textSecondary }} {...bottomSheetKeyboardProps}>
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.rosterHeader}>
            <ThemedText style={styles.sheetTitle}>{selectedGroupClass?.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{selectedGroupClass?.time} • Roster</ThemedText>
          </View>

          {/* Add Walk-in Section */}
          <ThemedText themeColor="textSecondary" style={styles.inputLabel}>Add to Roster</ThemedText>
          <BottomSheetTextInput
            style={[styles.input, { borderColor: theme.surface, color: theme.text, backgroundColor: theme.background }]}
            placeholder="Search clients or enter a walk-in..." placeholderTextColor={theme.textSecondary}
            value={addWalkInQuery} onChangeText={setAddWalkInQuery}
          />

          {/* Walk-in Autocomplete */}
          {addWalkInQuery.length > 0 && (rosterClientMatches.length > 0 || canCreateRosterClient) && (
            <View style={[styles.autocompleteContainer, { backgroundColor: theme.surface, borderColor: theme.backgroundElement }]}>
              <BottomSheetFlatList
                data={rosterClientMatches}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.autocompleteItem, styles.rosterAddClientRow, { borderBottomColor: theme.backgroundElement }]}
                    onPress={() => handleAddWalkIn(item)}
                    disabled={!!rosterActionClientId || creatingRosterClient}
                    activeOpacity={0.7}
                  >
                      <View style={styles.rosterAddClientText}>
                        <ThemedText style={styles.rosterAddClientName} numberOfLines={1}>{item.name}</ThemedText>
                        <View style={[styles.rosterPreviewPill, { backgroundColor: getClientPreviewTone(item).backgroundColor }]}>
                          <ThemedText style={[styles.rosterPreviewPillText, { color: getClientPreviewTone(item).textColor }]}>{item.groupStatusLabel}</ThemedText>
                        </View>
                      </View>
                    {rosterActionClientId === item.id ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                      <AppSymbol name="checkmark" size={17} tintColor={theme.textSecondary} />
                    )}
                  </TouchableOpacity>
                )}
                ListFooterComponent={
                  canCreateRosterClient ? (
                    <TouchableOpacity
                      style={[styles.autocompleteItem, styles.rosterAddClientRow, { borderBottomColor: theme.backgroundElement }]}
                      onPress={handleCreateWalkIn}
                      disabled={!!rosterActionClientId || creatingRosterClient}
                      activeOpacity={0.7}
                    >
                      <View style={styles.rosterAddClientText}>
                        <ThemedText style={styles.rosterAddClientName} numberOfLines={1}>Create and check in {addWalkInName}</ThemedText>
                        <View style={[styles.rosterPreviewPill, { backgroundColor: theme.backgroundElement }]}>
                          <ThemedText style={[styles.rosterPreviewPillText, { color: theme.success }]}>First class</ThemedText>
                        </View>
                      </View>
                      {creatingRosterClient ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <AppSymbol name="person.badge.plus" size={18} tintColor={theme.textSecondary} />
                      )}
                    </TouchableOpacity>
                  ) : null
                }
              />
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: theme.surface, marginVertical: Spacing.three }]} />

          <View style={styles.rosterListFrame}>
            <BottomSheetFlatList
              data={rosterLoading && rosterData.length === 0 ? [] : filteredRoster}
              keyExtractor={item => item.id}
              contentContainerStyle={{ paddingBottom: Spacing.six }}
              ListEmptyComponent={
                rosterLoading ? (
                  <View style={styles.rosterSkeletonList}>
                    {[0, 1, 2].map((item) => (
                      <View key={item} style={[styles.rosterSkeletonRow, { borderBottomColor: theme.surface }]}>
                        <View style={styles.rosterSkeletonTextColumn}>
                          <View style={[styles.rosterSkeletonName, { backgroundColor: theme.backgroundElement }]} />
                          <View style={[styles.rosterSkeletonMeta, { backgroundColor: theme.backgroundElement }]} />
                        </View>
                        <View style={[styles.rosterSkeletonButton, { backgroundColor: theme.surface }]} />
                      </View>
                    ))}
                  </View>
                ) : (
                  <ThemedText themeColor="textSecondary" style={styles.rosterEmptyText}>Roster is empty.</ThemedText>
                )
              }
              renderItem={({ item }) => (
                <View style={[styles.rosterRow, { borderBottomColor: theme.surface }]}>
                  <View style={styles.rosterRowMain}>
                    <ThemedText style={styles.rosterName} numberOfLines={1}>{item.name}</ThemedText>
                    <View style={[styles.rosterStatusPill, { backgroundColor: getRosterStatusDisplay(item).backgroundColor }]}>
                      <ThemedText style={[styles.rosterStatusText, { color: getRosterStatusDisplay(item).textColor }]}>
                        {getRosterStatusDisplay(item).label}
                      </ThemedText>
                    </View>
                  </View>
                  {item.checkedIn ? (
                    <TouchableOpacity
                      style={[styles.rosterUndoButton, { backgroundColor: theme.backgroundElement }]}
                      onPress={() => toggleRosterCheckIn(item)}
                      activeOpacity={0.7}
                      accessibilityLabel={`Undo check-in for ${item.name}`}
                    >
                      <AppSymbol name="arrow.uturn.backward" size={14} tintColor={theme.primary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            />
            {rosterLoading && rosterData.length > 0 && (
              <View style={[styles.rosterRefreshBadge, { backgroundColor: theme.backgroundElement, borderColor: theme.surface }]}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            )}
          </View>
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
  availableCard: { borderWidth: 1 },
  timeContainer: { width: 80, minWidth: 80, borderRightWidth: 1, marginRight: Spacing.three },
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
  availableActionBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  swipeAction: { justifyContent: 'center', alignItems: 'center', width: 70, borderRadius: Spacing.two },

  fab: { position: 'absolute', bottom: Spacing.four, right: Spacing.four, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },

  sheetContent: { flex: 1, padding: Spacing.four, paddingTop: Spacing.two },
  sheetScroll: { flex: 1 },
  sheetScrollContent: { padding: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.six },
  sheetTitle: { fontSize: 20, fontWeight: '800', marginBottom: Spacing.three },
  inputLabel: { fontWeight: '600', marginBottom: 6, fontSize: 13 },
  input: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, fontSize: 15, marginBottom: Spacing.three },
  autocompleteContainer: { maxHeight: 150, borderWidth: 1, borderRadius: Spacing.two, marginTop: -8, marginBottom: Spacing.three, overflow: 'hidden' },
  autocompleteItem: { padding: 12, borderBottomWidth: 1 },
  rosterAddClientRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  rosterAddClientText: { flex: 1, minWidth: 0, gap: 6 },
  rosterAddClientName: { fontSize: 15, fontWeight: '700' },
  rosterPreviewPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  rosterPreviewPillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  timeSelectorButton: { borderWidth: 1, borderRadius: Spacing.two, padding: 12, marginBottom: Spacing.three, justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  saveButton: { paddingVertical: 14, borderRadius: Spacing.two, alignItems: 'center' },
  saveButtonText: { fontWeight: '700', fontSize: 16 },

  rosterHeader: { marginBottom: Spacing.three },
  rosterListFrame: { flex: 1, minHeight: 240 },
  rosterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  rosterRowMain: { flex: 1, minWidth: 0, paddingRight: Spacing.two },
  rosterName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  rosterStatusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  rosterStatusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  rosterUndoButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rosterEmptyText: { textAlign: 'center', marginTop: Spacing.four },
  rosterRefreshBadge: { position: 'absolute', top: 8, right: 0, width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rosterSkeletonList: { paddingBottom: Spacing.six },
  rosterSkeletonRow: { minHeight: 61, paddingVertical: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rosterSkeletonTextColumn: { flex: 1, gap: 7 },
  rosterSkeletonName: { width: '44%', height: 16, borderRadius: 4 },
  rosterSkeletonMeta: { width: '26%', height: 11, borderRadius: 4 },
  rosterSkeletonButton: { width: 82, height: 34, borderRadius: Spacing.two },
});
