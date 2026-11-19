import { calculateCostBreakdown } from './itineraryEngine';
import {
  CostCategory,
  ExpenseCategory,
  ItemExpenseVariance,
  TripExpense,
  TripFinancialSummary,
  TripRecord,
} from '../types/roamplan';

export const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'food', label: 'Extra Food & Dining' },
  { value: 'transportation', label: 'Local Transport & Fuel' },
  { value: 'parking', label: 'Parking & Tolls' },
  { value: 'shopping', label: 'Shopping & Souvenirs' },
  { value: 'activities', label: 'Tickets & Activities' },
  { value: 'accommodation', label: 'Stay Extras' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
];

export function formatExpenseCategoryLabel(category: ExpenseCategory): string {
  switch (category) {
    case 'accommodation':
      return 'Accommodation';
    case 'transportation':
      return 'Transport';
    case 'activities':
      return 'Activities';
    case 'food':
      return 'Food & Dining';
    case 'parking':
      return 'Parking & Tolls';
    case 'shopping':
      return 'Shopping';
    case 'miscellaneous':
    default:
      return 'Miscellaneous';
  }
}

export function mapCostCategoryToExpenseCategory(category: CostCategory): ExpenseCategory {
  return category;
}

/**
 * Produces a deterministic document ID for an itinerary-item-linked expense so repeated saves
 * always update the exact same expense entry and never create duplicate records.
 */
export function getDeterministicItemExpenseId(itemId: string): string {
  const safe = itemId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96) || 'item';
  return `exp-item-${safe}`;
}

export function createAdditionalExpenseId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `exp-extra-${Date.now().toString(36)}-${rand}`;
}

export function sanitizeExpenseAmount(raw: number | string): number | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50000000) return null;
    return Math.round(parsed);
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 50000000) return null;
  return Math.round(raw);
}

export function findExpenseForItem(
  expenses: TripExpense[] | undefined,
  itemId: string
): TripExpense | undefined {
  if (!Array.isArray(expenses) || expenses.length === 0) return undefined;
  const deterministicId = getDeterministicItemExpenseId(itemId);
  return expenses.find(
    (e) =>
      (e.kind === 'itinerary_item' && e.itineraryItemId === itemId) || e.id === deterministicId
  );
}

export function upsertExpenseInList(
  expenses: TripExpense[] | undefined,
  nextExpense: TripExpense
): TripExpense[] {
  const list = Array.isArray(expenses) ? [...expenses] : [];
  const existingIdx = list.findIndex((entry) => {
    if (entry.id === nextExpense.id) return true;
    if (
      nextExpense.kind === 'itinerary_item' &&
      nextExpense.itineraryItemId &&
      entry.kind === 'itinerary_item' &&
      entry.itineraryItemId === nextExpense.itineraryItemId
    ) {
      return true;
    }
    return false;
  });

  if (existingIdx !== -1) {
    list[existingIdx] = nextExpense;
    return list;
  }

  return [nextExpense, ...list];
}

export function removeExpenseFromList(
  expenses: TripExpense[] | undefined,
  expenseId: string
): TripExpense[] {
  if (!Array.isArray(expenses)) return [];
  return expenses.filter((entry) => entry.id !== expenseId);
}

export function computeItemExpenseVariance(
  estimatedCostInr: number,
  actualCostInr: number
): ItemExpenseVariance {
  const est = Math.max(0, Math.round(Number.isFinite(estimatedCostInr) ? estimatedCostInr : 0));
  const act = Math.max(0, Math.round(Number.isFinite(actualCostInr) ? actualCostInr : 0));
  const differenceInr = act - est;
  const status: ItemExpenseVariance['status'] =
    differenceInr > 0 ? 'over' : differenceInr < 0 ? 'under' : 'exact';

  return {
    estimatedCostInr: est,
    actualCostInr: act,
    differenceInr,
    status,
  };
}

/**
 * Computes the complete financial summary for a trip using Estimated Total Trip Cost as the
 * baseline (never the planning-time Target Budget). Actual expenditure strictly counts only
 * explicitly recorded expenses; completing an itinerary item never auto-adds expenditure.
 */
export function computeTripFinancialSummary(
  trip: Pick<TripRecord, 'items' | 'estimatedTotalInr' | 'travellers' | 'expenses'>
): TripFinancialSummary {
  const estimatedTotalInr =
    Array.isArray(trip.items) && trip.items.length > 0
      ? calculateCostBreakdown(trip.items).totalInr
      : Math.max(0, Math.round(Number.isFinite(trip.estimatedTotalInr) ? trip.estimatedTotalInr : 0));

  const rawExpenses = Array.isArray(trip.expenses) ? trip.expenses : [];

  // Defensively deduplicate by expense id and (for itinerary_item expenses) by itineraryItemId
  // so the same recorded expense can never be double-counted.
  const dedupedByKey = new Map<string, TripExpense>();
  for (const exp of rawExpenses) {
    if (!exp || typeof exp.id !== 'string' || exp.id.trim().length === 0) continue;
    const dedupeKey =
      exp.kind === 'itinerary_item' && exp.itineraryItemId
        ? `item:${exp.itineraryItemId}`
        : `id:${exp.id}`;
    const prev = dedupedByKey.get(dedupeKey);
    if (!prev || (exp.updatedAt || '').localeCompare(prev.updatedAt || '') >= 0) {
      dedupedByKey.set(dedupeKey, exp);
    }
  }
  const expenses = Array.from(dedupedByKey.values());

  let itemizedActualInr = 0;
  let additionalActualInr = 0;
  let recordedItemExpenseCount = 0;
  let additionalExpenseCount = 0;

  for (const exp of expenses) {
    const amt = Math.max(0, Math.round(Number.isFinite(exp.amountInr) ? exp.amountInr : 0));
    if (exp.kind === 'itinerary_item') {
      itemizedActualInr += amt;
      recordedItemExpenseCount += 1;
    } else {
      additionalActualInr += amt;
      additionalExpenseCount += 1;
    }
  }

  const actualTotalInr = itemizedActualInr + additionalActualInr;
  const remainingBudgetInr = estimatedTotalInr - actualTotalInr;
  const isOverBudget = actualTotalInr > estimatedTotalInr;
  const overBudgetInr = isOverBudget ? actualTotalInr - estimatedTotalInr : 0;

  let budgetUtilizationPct = 0;
  if (actualTotalInr <= 0) {
    budgetUtilizationPct = 0;
  } else if (estimatedTotalInr > 0) {
    const rawPct = (actualTotalInr / estimatedTotalInr) * 100;
    const roundedTenth = Math.round(rawPct * 10) / 10;
    // Never round small positive recorded expenses down to 0%; keep >100% uncapped
    budgetUtilizationPct = rawPct < 10 ? Math.max(0.1, roundedTenth) : roundedTenth;
  } else {
    budgetUtilizationPct = 100;
  }

  const budgetUtilizationBarPct =
    actualTotalInr <= 0 ? 0 : Math.min(100, Math.max(2, budgetUtilizationPct));

  const safeTravellers = Math.max(1, Math.round(Number.isFinite(trip.travellers) ? trip.travellers : 1));
  const estimatedPerTravellerInr = Math.round(estimatedTotalInr / safeTravellers);
  const actualPerTravellerAvgInr = Math.round(actualTotalInr / safeTravellers);

  return {
    estimatedTotalInr,
    actualTotalInr,
    itemizedActualInr,
    additionalActualInr,
    remainingBudgetInr,
    isOverBudget,
    overBudgetInr,
    budgetUtilizationPct,
    budgetUtilizationBarPct,
    estimatedPerTravellerInr,
    actualPerTravellerAvgInr,
    recordedExpenseCount: recordedItemExpenseCount + additionalExpenseCount,
    recordedItemExpenseCount,
    additionalExpenseCount,
  };
}

export function computeDateForTripDay(startDate: string, dayNumber: number): string {
  const base = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) {
    return /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate
      : new Date().toISOString().slice(0, 10);
  }
  base.setDate(base.getDate() + Math.max(0, dayNumber - 1));
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTripDateRange(startDate: string, days: number): string {
  const safeDays = Math.max(1, Math.round(Number.isFinite(days) ? days : 1));
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return startDate;
  }
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + (safeDays - 1));

  const fmtDayMonth = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  const fmtFull = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (safeDays === 1) {
    return fmtFull.format(start);
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${fmtDayMonth.format(start)} – ${fmtFull.format(end)}`;
  }
  return `${fmtFull.format(start)} – ${fmtFull.format(end)}`;
}
