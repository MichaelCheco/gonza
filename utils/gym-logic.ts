import dayjs from 'dayjs';

export const SERVICE_TYPES = {
  GROUP: 'group',
  PERSONAL_TRAINING: 'personal_training',
} as const;

export type ServiceType = typeof SERVICE_TYPES[keyof typeof SERVICE_TYPES];
export type PaymentStatus = 'paid' | 'unpaid' | 'voided' | string;

export type PackageRow = {
  id: number;
  name: string;
  price?: number | string | null;
  total_classes: number | null;
  expires_in_weeks: number | null;
  service_type: ServiceType;
  is_unlimited: boolean;
};

export type ClientPackageRow = {
  id: number;
  client_id?: number;
  package_id: number;
  classes_remaining: number | null;
  start_date: string | null;
  expiration_date: string | null;
  payment_status: PaymentStatus;
  packages: PackageRow | null;
};

export type PackageStatus = {
  active: boolean;
  reason: 'Good to go' | 'Unpaid Balance' | 'Out of Classes' | 'Package Expired' | 'Voided';
};

export type ServiceSummary = {
  serviceType: ServiceType;
  label: string;
  usableClasses: number;
  hasUnlimited: boolean;
  activeCount: number;
  totalCount: number;
  unpaidCount: number;
  expiredCount: number;
  outOfClassesCount: number;
  needsAttention: boolean;
  reason: string;
};

export type IntroPromoKind = 'group_first_class' | 'pt_first_session';

const normalizePackageName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function isFirstClassFreePackage(pkg: Pick<PackageRow, 'name'> | null | undefined): boolean {
  return normalizePackageName(pkg?.name ?? '') === 'firstclassfree';
}

export function getIntroPromoKind(pkg: Pick<PackageRow, 'name'> | null | undefined): IntroPromoKind | null {
  const normalizedName = normalizePackageName(pkg?.name ?? '');

  if (normalizedName === 'firstclassfree') return 'group_first_class';
  if (normalizedName === 'firstptpromo') return 'pt_first_session';

  return null;
}

export function isIntroPromoPackage(pkg: Pick<PackageRow, 'name'> | null | undefined): boolean {
  return getIntroPromoKind(pkg) !== null;
}

export function hasClientReceivedIntroPromo(
  clientPackages: Pick<ClientPackageRow, 'payment_status' | 'packages'>[],
  pkg: Pick<PackageRow, 'name'> | null | undefined
): boolean {
  const promoKind = getIntroPromoKind(pkg);
  if (!promoKind) return false;

  return clientPackages.some((clientPackage) => (
    clientPackage.payment_status !== 'voided' &&
    getIntroPromoKind(clientPackage.packages) === promoKind
  ));
}

export function isUnlimitedPackage(pkg: Pick<PackageRow, 'is_unlimited'> | null | undefined): boolean {
  return !!pkg?.is_unlimited;
}

export function isClientPackageUnpaid(clientPackage: Pick<ClientPackageRow, 'payment_status' | 'packages'>): boolean {
  return clientPackage.payment_status === 'unpaid' && !isFirstClassFreePackage(clientPackage.packages);
}

export function calculateExpirationDateFromPackage(
  pkg: Pick<PackageRow, 'expires_in_weeks'>,
  startDate: string | Date = new Date()
): string | null {
  if (!pkg.expires_in_weeks) return null;
  return dayjs(startDate).add(pkg.expires_in_weeks, 'week').format('YYYY-MM-DD');
}

export function getServiceLabel(serviceType: ServiceType): string {
  return serviceType === SERVICE_TYPES.PERSONAL_TRAINING ? 'PT' : 'Group';
}

export function getClientPackageStatus(clientPackage: Pick<ClientPackageRow, 'classes_remaining' | 'expiration_date' | 'payment_status' | 'packages'>): PackageStatus {
  if (clientPackage.payment_status === 'voided') return { active: false, reason: 'Voided' };
  if (isClientPackageUnpaid(clientPackage)) return { active: false, reason: 'Unpaid Balance' };

  if (clientPackage.expiration_date && dayjs().isAfter(dayjs(clientPackage.expiration_date).endOf('day'))) {
    return { active: false, reason: 'Package Expired' };
  }

  if (isUnlimitedPackage(clientPackage.packages)) return { active: true, reason: 'Good to go' };
  if (clientPackage.classes_remaining === null || clientPackage.classes_remaining <= 0) return { active: false, reason: 'Out of Classes' };

  return { active: true, reason: 'Good to go' };
}

export function isClientPackageUsable(clientPackage: Pick<ClientPackageRow, 'classes_remaining' | 'expiration_date' | 'payment_status' | 'packages'>): boolean {
  return getClientPackageStatus(clientPackage).active;
}

export function summarizePackagesByService(
  clientPackages: ClientPackageRow[],
  serviceType: ServiceType
): ServiceSummary {
  const matchingPackages = clientPackages.filter((clientPackage) => (
    clientPackage.packages?.service_type === serviceType &&
    clientPackage.payment_status !== 'voided'
  ));
  const activePackages = matchingPackages.filter(isClientPackageUsable);
  const unpaidCount = matchingPackages.filter(isClientPackageUnpaid).length;
  const statusByPackage = matchingPackages.map(getClientPackageStatus);
  const expiredCount = statusByPackage.filter((status) => status.reason === 'Package Expired').length;
  const outOfClassesCount = statusByPackage.filter((status) => status.reason === 'Out of Classes').length;
  const hasUnlimited = activePackages.some((clientPackage) => isUnlimitedPackage(clientPackage.packages));
  const usableClasses = activePackages.reduce((sum, clientPackage) => (
    sum + (isUnlimitedPackage(clientPackage.packages) ? 0 : clientPackage.classes_remaining ?? 0)
  ), 0);

  let reason = `${usableClasses} left`;
  if (unpaidCount > 0) reason = `${unpaidCount} unpaid`;
  else if (hasUnlimited) reason = 'Unlimited';
  else if (usableClasses === 0 && matchingPackages.length > 0) reason = 'No usable credits';
  else if (matchingPackages.length === 0) reason = 'None';

  return {
    serviceType,
    label: getServiceLabel(serviceType),
    usableClasses,
    hasUnlimited,
    activeCount: activePackages.length,
    totalCount: matchingPackages.length,
    unpaidCount,
    expiredCount,
    outOfClassesCount,
    needsAttention: unpaidCount > 0 || (!hasUnlimited && matchingPackages.length > 0 && usableClasses === 0),
    reason,
  };
}

export function sortClientPackages(clientPackages: ClientPackageRow[]): ClientPackageRow[] {
  return [...clientPackages].sort((a, b) => b.id - a.id);
}
