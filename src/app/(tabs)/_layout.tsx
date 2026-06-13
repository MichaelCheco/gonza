import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AppSymbol } from '@/components/app-symbol';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';

export default function TabsLayout() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const { status } = useAuth();

  if (status !== 'authorized') return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.backgroundElement,
        },
      }}
    >
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
    </Tabs>
  );
}
