// src/app/_layout.tsx
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, Tabs, ThemeProvider } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    // CRITICAL: GestureHandlerRootView must have flex: 1 to fill the screen
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

          </Tabs>
        </BottomSheetModalProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}