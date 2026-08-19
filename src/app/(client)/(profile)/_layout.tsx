import Stack from 'expo-router/stack';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="profile" options={{ title: 'Passes & Profile', headerLargeTitle: true }} />
    </Stack>
  );
}
