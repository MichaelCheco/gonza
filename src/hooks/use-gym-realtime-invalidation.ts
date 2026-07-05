import { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { gymQueryKeys } from '@/lib/gym-queries';
import { supabase } from '../../utils/supabase';

const REALTIME_TABLES = ['clients', 'client_packages', 'classes', 'attendance', 'packages'] as const;

export function useGymRealtimeInvalidation(queryClient: QueryClient, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase.channel('gym-data-invalidation');

    REALTIME_TABLES.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (table === 'clients' || table === 'client_packages') {
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clients });
          }

          if (table === 'packages') {
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.packages });
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clients });
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clientClassHistories });
          }

          if (table === 'classes') {
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.classes });
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clientClassHistories });
          }

          if (table === 'attendance') {
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.classes });
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.rosters });
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clients });
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clientClassHistories });
          }

          if (table === 'client_packages') {
            queryClient.invalidateQueries({ queryKey: gymQueryKeys.clientClassHistories });
          }
        }
      );
    });

    channel.subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Realtime subscription error', status, error);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
