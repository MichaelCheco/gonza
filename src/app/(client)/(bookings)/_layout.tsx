import Stack from 'expo-router/stack';

export default function BookingsLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="bookings" options={{ title: 'My Bookings', headerLargeTitle: true }} />
    </Stack>
  );
}
