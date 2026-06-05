// src/app/_layout.tsx
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, Tabs, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/providers/auth-provider';

// This component isolates the routing logic so it can consume the AuthContext
function RootLayoutNav() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const { session } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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
  }, [session, segments]);

  // Optionally render a loading screen while session is `undefined`
  if (session === undefined) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
                  <SymbolView name="calendar" size={24} tintColor={color} />
                ),
              }}
            />

            <Tabs.Screen
              name="clients"
              options={{
                title: 'Clients',
                tabBarIcon: ({ color }) => (
                  <SymbolView name="person.3.fill" size={24} tintColor={color} />
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