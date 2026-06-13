import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: 'always',
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

let isAppStateListenerRegistered = false;

export function registerQueryFocusManager() {
  if (isAppStateListenerRegistered || Platform.OS === 'web') return;
  isAppStateListenerRegistered = true;

  AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
}
