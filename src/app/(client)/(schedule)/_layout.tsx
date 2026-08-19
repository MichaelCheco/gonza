import Stack from 'expo-router/stack';

export default function ScheduleLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Schedule', headerLargeTitle: true }} />
      <Stack.Screen
        name="confirm"
        options={{
          title: 'Confirm Booking',
          presentation: 'formSheet',
          sheetGrabberVisible: true,
          sheetAllowedDetents: [0.75, 1],
        }}
      />
    </Stack>
  );
}
