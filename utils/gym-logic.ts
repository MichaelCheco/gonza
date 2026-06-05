// src/utils/gym-logic.ts
import dayjs from 'dayjs';

// --- Package Identifiers ---
export const PACKAGE_TYPES = {
    MONTHLY_MEMBERSHIP: 'monthly_membership',
    FLEXIBLE_PACK: 'flexible_pack',
    PT_SINGLE: 'pt_single',
    PT_PACK: 'pt_pack',
    PROMO_GROUP: 'promo_group',
    PROMO_PT: 'promo_pt',
} as const;

export type PackageType = typeof PACKAGE_TYPES[keyof typeof PACKAGE_TYPES];

// --- The Gym's Source of Truth ---
export const GYM_PACKAGES = {
    [PACKAGE_TYPES.MONTHLY_MEMBERSHIP]: {
        name: 'Monthly Membership',
        price: 250,
        totalClasses: 8,
        expiresInWeeks: 4, // Strict 4-week expiration
    },
    [PACKAGE_TYPES.FLEXIBLE_PACK]: {
        name: '8-Class Pack', // Removed " (Flexible)"
        price: 300,
        totalClasses: 8,
        expiresInWeeks: null,
    },
    [PACKAGE_TYPES.PT_SINGLE]: {
        name: 'Single PT Session',
        price: 150,
        totalClasses: 1,
        expiresInWeeks: 4,
    },
    [PACKAGE_TYPES.PT_PACK]: {
        name: '8-Session PT Pack',
        price: 1100,
        totalClasses: 8,
        expiresInWeeks: 12, // Usually PT packs have a longer shelf life, adjust as needed
    },
    [PACKAGE_TYPES.PROMO_GROUP]: {
        name: 'First Class Free',
        price: 0,
        totalClasses: 1,
        expiresInWeeks: 1,
    },
    [PACKAGE_TYPES.PROMO_PT]: {
        name: 'First PT Promo',
        price: 75,
        totalClasses: 1,
        expiresInWeeks: 2,
    },
} as const;

// --- Core Helper Functions ---

/**
 * Calculates the exact expiration date based on the package rules.
 * Uses dayjs to accurately calculate "4 weeks from today".
 */
export function calculateExpirationDate(
    packageType: PackageType,
    startDate: string | Date = new Date()
): string | null {
    const rules = GYM_PACKAGES[packageType];

    // Flexible packages return null (no expiration)
    if (rules.expiresInWeeks === null) return null;

    // Monthly packages return exactly X weeks from the start date
    return dayjs(startDate)
        .add(rules.expiresInWeeks, 'week')
        .format('YYYY-MM-DD');
}

/**
 * Evaluates if a client is legally allowed to check in today.
 * They must have classes remaining AND their expiration date must be in the future (or null).
 */
export function isPackageActive(classesRemaining: number, expirationDate: string | null): boolean {
    // Rule 1: Must have classes in the bank
    if (classesRemaining <= 0) return false;

    // Rule 2: If the package has an expiration date, it must not be in the past
    if (expirationDate) {
        // We use .endOf('day') to ensure they can still check in ON the day it expires
        const isExpired = dayjs().isAfter(dayjs(expirationDate).endOf('day'));
        if (isExpired) return false;
    }

    return true;
}

/**
 * Returns a human-readable status for UI alerts (e.g., the red traffic light logic)
 */
export function getClientStatus(classesRemaining: number, expirationDate: string | null, paymentStatus: 'paid' | 'unpaid') {
    if (paymentStatus === 'unpaid') return { active: false, reason: 'Unpaid Balance' };
    if (classesRemaining <= 0) return { active: false, reason: 'Out of Classes' };

    if (expirationDate && dayjs().isAfter(dayjs(expirationDate).endOf('day'))) {
        return { active: false, reason: 'Package Expired' };
    }

    return { active: true, reason: 'Good to go' };
}