import dayjs from 'dayjs';

import {
  ClientPackageRow,
  isFirstClassFreePackage,
  isUnlimitedPackage,
  PackageRow,
  SERVICE_TYPES,
  ServiceSummary,
  sortClientPackages,
  summarizePackagesByService,
} from '../../utils/gym-logic';
import { supabase } from '../../utils/supabase';

export type ClientRecord = {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  instagram_handle: string | null;
  name: string;
  client_packages: ClientPackageRow[];
  packageSummaries: ServiceSummary[];
};

export type ClientOption = {
  id: string;
  name: string;
  groupStatusLabel: string;
  groupStatusTone: 'ok' | 'attention' | 'last';
};

export type SessionType = {
  id: string;
  time: string;
  title: string;
  type: string;
  clientId?: string;
  checkedIn?: boolean;
};

export type RosterItem = {
  id: string;
  clientId: string;
  name: string;
  checkedIn: boolean;
  clientPackageId: string | null;
  remainingAfter: number | null;
  isUnlimited: boolean;
  status: RosterStatus;
};

export type RosterStatus = 'checked_in' | 'last_class' | 'first_class' | 'no_active_package' | 'already_checked_in';

const SERVICE_ORDER = [SERVICE_TYPES.GROUP, SERVICE_TYPES.PERSONAL_TRAINING];

export const gymQueryKeys = {
  all: ['gym'] as const,
  clients: ['gym', 'clients'] as const,
  packages: ['gym', 'packages'] as const,
  classes: ['gym', 'classes'] as const,
  classesByDate: (date: string) => ['gym', 'classes', date] as const,
  rosters: ['gym', 'rosters'] as const,
  roster: (classId: string | null | undefined) => ['gym', 'rosters', classId ?? 'none'] as const,
};

export function decorateClient(client: any): ClientRecord {
  const ledger = sortClientPackages((client.client_packages || []) as ClientPackageRow[]);

  return {
    ...client,
    name: `${client.first_name} ${client.last_name}`.trim(),
    client_packages: ledger,
    packageSummaries: SERVICE_ORDER.map((serviceType) => summarizePackagesByService(ledger, serviceType)),
  };
}

function getGroupRosterPreview(client: ClientRecord): Pick<ClientOption, 'groupStatusLabel' | 'groupStatusTone'> {
  const groupSummary = client.packageSummaries.find((summary) => summary.serviceType === SERVICE_TYPES.GROUP);

  if (!groupSummary || groupSummary.totalCount === 0) {
    return { groupStatusLabel: 'No package', groupStatusTone: 'attention' };
  }

  if (groupSummary.unpaidCount > 0) {
    return { groupStatusLabel: 'Unpaid', groupStatusTone: 'attention' };
  }

  if (groupSummary.hasUnlimited) {
    return { groupStatusLabel: 'Unlimited', groupStatusTone: 'ok' };
  }

  if (groupSummary.usableClasses <= 0) {
    return { groupStatusLabel: 'No active package', groupStatusTone: 'attention' };
  }

  if (groupSummary.usableClasses === 1) {
    return { groupStatusLabel: 'Last class', groupStatusTone: 'last' };
  }

  return { groupStatusLabel: `${groupSummary.usableClasses} left`, groupStatusTone: 'ok' };
}

export function toClientOption(client: ClientRecord): ClientOption {
  const groupPreview = getGroupRosterPreview(client);

  return {
    id: client.id.toString(),
    name: client.name,
    ...groupPreview,
  };
}

export async function fetchClients(): Promise<ClientRecord[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      id, first_name, last_name, phone, instagram_handle,
      client_packages (
        id, client_id, package_id, classes_remaining, start_date, expiration_date, payment_status,
        packages ( id, name, price, total_classes, expires_in_weeks, service_type, is_unlimited )
      )
    `)
    .order('first_name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(decorateClient);
}

export async function fetchPackages(): Promise<PackageRow[]> {
  const { data, error } = await supabase
    .from('packages')
    .select('id, name, price, total_classes, expires_in_weeks, service_type, is_unlimited')
    .order('service_type', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

export async function fetchClassesByDate(selectedDate: string): Promise<SessionType[]> {
  const { error: templateError } = await supabase.rpc('generate_classes_from_templates', {
    p_start_date: dayjs(selectedDate).subtract(14, 'day').format('YYYY-MM-DD'),
    p_end_date: dayjs(selectedDate).add(14, 'day').format('YYYY-MM-DD'),
  });

  if (templateError) {
    console.error('Template Schedule Error:', templateError.message);
  }

  const { data, error } = await supabase
    .from('classes')
    .select(`
      id,
      title,
      class_type,
      start_time,
      attendance (
        client_package_id,
        client_id,
        clients (id, first_name, last_name)
      )
    `)
    .eq('scheduled_date', selectedDate)
    .order('start_time', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((session) => {
    const isPT = session.class_type === 'Personal Training';
    const firstAttendee = session.attendance?.[0]?.clients as any;

    return {
      id: session.id.toString(),
      time: dayjs(`${selectedDate}T${session.start_time}`).format('h:mm A'),
      title: isPT && firstAttendee ? `${firstAttendee.first_name} ${firstAttendee.last_name}` : session.title,
      type: session.class_type,
      clientId: firstAttendee?.id?.toString(),
      checkedIn: !!session.attendance?.[0]?.client_package_id,
    };
  });
}

export async function fetchRoster(classId: string): Promise<RosterItem[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select(`
      id,
      client_id,
      client_package_id,
      clients ( id, first_name, last_name ),
      client_packages (
        id,
        classes_remaining,
        packages ( id, name, service_type, is_unlimited )
      )
    `)
    .eq('class_id', classId);

  if (error) throw error;

  return (data ?? []).map((attendanceRow) => {
    const clientData = attendanceRow.clients as any;
    const clientPackageData = attendanceRow.client_packages as any;
    const clientPackage = Array.isArray(clientPackageData) ? clientPackageData[0] : clientPackageData;
    const remainingAfter = typeof clientPackage?.classes_remaining === 'number' ? clientPackage.classes_remaining : null;
    const isUnlimited = isUnlimitedPackage(clientPackage?.packages);
    const checkedIn = !!attendanceRow.client_package_id;
    let status: RosterStatus = checkedIn ? 'checked_in' : 'no_active_package';

    if (checkedIn && isFirstClassFreePackage(clientPackage?.packages)) {
      status = 'first_class';
    } else if (checkedIn && !isUnlimited && remainingAfter === 0) {
      status = 'last_class';
    }

    return {
      id: attendanceRow.id.toString(),
      clientId: attendanceRow.client_id.toString(),
      name: `${clientData.first_name} ${clientData.last_name}`.trim(),
      checkedIn,
      clientPackageId: attendanceRow.client_package_id?.toString() ?? null,
      remainingAfter,
      isUnlimited,
      status,
    };
  });
}
