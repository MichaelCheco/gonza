import dayjs from 'dayjs';

import {
  ClientPackageRow,
  SERVICE_TYPES,
  ServiceSummary,
  sortClientPackages,
  summarizePackagesByService,
} from '@/utils/gym-logic';
import { supabase } from '../../utils/supabase';

export type SessionKind = 'group' | 'personal_training';

export type BookableSession = {
  kind: SessionKind;
  id: string;
  title: string;
  serviceType: SessionKind;
  startsAt: string;
  endsAt: string;
  coachName: string;
  spotsRemaining: number;
  isBooked: boolean;
};

export type BookingStatus = 'booked' | 'attended' | 'no_show' | 'cancelled';

export type ClientBooking = {
  id: string;
  serviceType: SessionKind;
  sessionTitle: string;
  startsAt: string;
  endsAt: string;
  coachName: string | null;
  status: BookingStatus;
  cancellationCutoffAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  creditRefundedAt: string | null;
};

export type ClientProfile = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  instagramHandle: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  experienceLevel: string | null;
  clientPackages: ClientPackageRow[];
  groupSummary: ServiceSummary;
  ptSummary: ServiceSummary;
};

export type ClientProfileUpdate = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  instagramHandle: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  experienceLevel: string | null;
};

export type BookingMutationResult = {
  bookingId: string;
  remainingAfter: number | null;
  isUnlimited: boolean;
  cancellationCutoffAt: string;
};

export type CancellationResult = {
  bookingId: string;
  creditRefunded: boolean;
  cancellationStatus: string;
};

export type ClientGymSettings = {
  cancellationWindowHours: number;
  timezone: string;
};

export const clientQueryKeys = {
  all: ['client'] as const,
  profile: (clientId: number | null | undefined) => ['client', 'profile', clientId ?? 'none'] as const,
  schedules: ['client', 'schedule'] as const,
  schedule: (date: string) => ['client', 'schedule', date] as const,
  bookings: (clientId: number | null | undefined) => ['client', 'bookings', clientId ?? 'none'] as const,
  settings: ['client', 'settings'] as const,
};

export async function fetchClientGymSettings(): Promise<ClientGymSettings> {
  const { data, error } = await supabase
    .from('gym_settings')
    .select('cancellation_window_hours, timezone')
    .eq('id', true)
    .single();

  if (error) throw error;

  return {
    cancellationWindowHours: data.cancellation_window_hours,
    timezone: data.timezone,
  };
}

export async function fetchBookableSchedule(date: string): Promise<BookableSession[]> {
  const startAt = dayjs(date).startOf('day');
  const endAt = startAt.add(1, 'day');
  const { data, error } = await supabase.rpc('get_bookable_schedule', {
    p_start_at: startAt.toISOString(),
    p_end_at: endAt.toISOString(),
  });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    kind: row.session_kind as SessionKind,
    id: row.session_id.toString(),
    title: row.title,
    serviceType: row.service_type as SessionKind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    coachName: row.coach_name,
    spotsRemaining: row.spots_remaining,
    isBooked: row.is_booked,
  }));
}

export async function fetchClientProfile(clientId: number): Promise<ClientProfile> {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      id,
      first_name,
      last_name,
      email,
      phone,
      instagram_handle,
      emergency_contact_name,
      emergency_contact_phone,
      experience_level,
      client_packages (
        id,
        client_id,
        package_id,
        classes_remaining,
        start_date,
        expiration_date,
        payment_status,
        packages (
          id,
          name,
          price,
          total_classes,
          expires_in_weeks,
          service_type,
          is_unlimited,
          package_kind
        )
      )
    `)
    .eq('id', clientId)
    .single();

  if (error) throw error;

  const clientPackages = sortClientPackages((data.client_packages ?? []) as unknown as ClientPackageRow[]);

  return {
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    instagramHandle: data.instagram_handle ?? '',
    emergencyContactName: data.emergency_contact_name ?? '',
    emergencyContactPhone: data.emergency_contact_phone ?? '',
    experienceLevel: data.experience_level ?? null,
    clientPackages,
    groupSummary: summarizePackagesByService(clientPackages, SERVICE_TYPES.GROUP),
    ptSummary: summarizePackagesByService(clientPackages, SERVICE_TYPES.PERSONAL_TRAINING),
  };
}

export async function updateClientProfile(clientId: number, update: ClientProfileUpdate): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({
      first_name: update.firstName.trim(),
      last_name: update.lastName.trim(),
      email: update.email.trim() || null,
      phone: update.phone.trim() || null,
      instagram_handle: update.instagramHandle.trim().replace(/^@+/, '') || null,
      emergency_contact_name: update.emergencyContactName.trim() || null,
      emergency_contact_phone: update.emergencyContactPhone.trim() || null,
      experience_level: update.experienceLevel,
    })
    .eq('id', clientId);

  if (error) throw error;
}

export async function fetchClientBookings(clientId: number): Promise<ClientBooking[]> {
  const { error: finalizeError } = await supabase.rpc('finalize_my_past_bookings');
  if (finalizeError) throw finalizeError;

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id,
      service_type,
      session_title,
      starts_at,
      ends_at,
      coach_name,
      status,
      cancellation_cutoff_at,
      cancelled_at,
      cancellation_reason,
      credit_refunded_at
    `)
    .eq('client_id', clientId)
    .order('starts_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id.toString(),
    serviceType: row.service_type as SessionKind,
    sessionTitle: row.session_title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    coachName: row.coach_name,
    status: row.status as BookingStatus,
    cancellationCutoffAt: row.cancellation_cutoff_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    creditRefundedAt: row.credit_refunded_at,
  }));
}

export async function bookClientSession(kind: SessionKind, sessionId: string): Promise<BookingMutationResult> {
  const rpcName = kind === 'group' ? 'book_my_group_class' : 'book_my_pt_slot';
  const rpcParams = kind === 'group'
    ? { p_class_id: Number(sessionId) }
    : { p_availability_slot_id: Number(sessionId) };
  const { data, error } = await supabase.rpc(rpcName, rpcParams);

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The booking could not be completed.');

  return {
    bookingId: row.booking_id.toString(),
    remainingAfter: row.remaining_after,
    isUnlimited: row.is_unlimited,
    cancellationCutoffAt: row.cancellation_cutoff_at,
  };
}

export async function cancelClientBooking(bookingId: string): Promise<CancellationResult> {
  const { data, error } = await supabase.rpc('cancel_my_booking', {
    p_booking_id: Number(bookingId),
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The booking could not be cancelled.');

  return {
    bookingId: row.booking_id.toString(),
    creditRefunded: row.credit_refunded,
    cancellationStatus: row.cancellation_status,
  };
}
