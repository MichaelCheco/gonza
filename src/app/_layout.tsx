// src/app/_layout.tsx
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Tabs, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { AppSymbol } from '@/components/app-symbol';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { useGymRealtimeInvalidation } from '@/hooks/use-gym-realtime-invalidation';
import { queryClient, registerQueryFocusManager } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/providers/auth-provider';

// This component isolates the routing logic so it can consume the AuthContext
function RootLayoutNav() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const { session } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    registerQueryFocusManager();
  }, []);

  useGymRealtimeInvalidation(queryClient, !!session);

  useEffect(() => {
    if (session === undefined) return; // Wait until session state is determined

    const inAuthGroup = segments[0] === 'auth';

    if (!session && !inAuthGroup) {
      // Redirect unauthenticated users to the auth screen
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      // Redirect authenticated users away from the auth screen
      router.replace('/');
    }
  }, [router, session, segments]);

  // Optionally render a loading screen while session is `undefined`
  if (session === undefined) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <BottomSheetModalProvider>
            <Tabs
              screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: theme.primary,
                tabBarInactiveTintColor: theme.textSecondary,
                tabBarStyle: {
                  backgroundColor: theme.background,
                  borderTopColor: theme.backgroundElement,
                  display: segments[0] === 'auth' ? 'none' : 'flex', // Hide tabs on auth screen
                },
              }}>

              <Tabs.Screen
                name="index"
                options={{
                  title: 'Schedule',
                  tabBarIcon: ({ color }) => (
                    <AppSymbol name="calendar" size={24} tintColor={color} />
                  ),
                }}
              />

              <Tabs.Screen
                name="clients"
                options={{
                  title: 'Clients',
                  lazy: false,
                  tabBarIcon: ({ color }) => (
                    <AppSymbol name="person.3.fill" size={24} tintColor={color} />
                  ),
                }}
              />

              {/* Hide the auth screen from the bottom tab bar explicitly */}
              <Tabs.Screen
                name="auth"
                options={{ href: null }}
              />
            </Tabs>
          </BottomSheetModalProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Wrap the Nav in the AuthProvider
export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
