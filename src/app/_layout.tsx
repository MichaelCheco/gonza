import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { useGymRealtimeInvalidation } from '@/hooks/use-gym-realtime-invalidation';
import { queryClient, registerQueryFocusManager } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/providers/auth-provider';

function LoadingGate() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

function RootLayoutNav() {
  const scheme = useColorScheme();
  const { status } = useAuth();

  useEffect(() => {
    registerQueryFocusManager();
  }, []);

  useGymRealtimeInvalidation(queryClient, status === 'authorized');

  if (status === 'loading' || status === 'checkingAdmin') {
    return <LoadingGate />;
  }

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BottomSheetModalProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={status !== 'authorized'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'authorized'}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
      </BottomSheetModalProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
