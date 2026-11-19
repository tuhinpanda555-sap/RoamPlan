import { SAMPLE_PROVENANCE, UNCONFIRMED_ENQUIRY_NOTICE } from '../data/sampleCatalogue';
import { calculateCostBreakdown } from '../engine/itineraryEngine';
import {
  BookingEnquiryDraft,
  BookingRequest,
  ItineraryItem,
  TripRecord,
} from '../types/roamplan';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEYS = {
  trips: 'roamplan_saved_trips_v2',
  enquiries: 'roamplan_booking_enquiries_v2',
};

function getDefaultStorage(): StorageLike | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function safeReadJson<T>(key: string, fallback: T, storage?: StorageLike): T {
  const store = storage ?? getDefaultStorage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson<T>(key: string, value: T, storage?: StorageLike): void {
  const store = storage ?? getDefaultStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Unable to save trip data in browser storage: ${err.message}`
        : 'Unable to save trip data in browser storage.'
    );
  }
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function listSavedTrips(storage?: StorageLike): TripRecord[] {
  const all = safeReadJson<TripRecord[]>(KEYS.trips, [], storage);
  if (!Array.isArray(all)) return [];
  return all
    .map((trip) => ({
      ...trip,
      expenses: Array.isArray(trip.expenses) ? trip.expenses : [],
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveTrip(
  tripData: Omit<
    TripRecord,
    'id' | 'createdAt' | 'updatedAt' | 'costBreakdown' | 'estimatedTotalInr' | 'withinBudget'
  >,
  existingTripId?: string,
  storage?: StorageLike
): TripRecord {
  const all = listSavedTrips(storage);
  const now = new Date().toISOString();

  if (existingTripId) {
    const index = all.findIndex((t) => t.id === existingTripId);
    if (index !== -1) {
      const normalizedItems: ItineraryItem[] = tripData.items.map((item) => ({
        ...item,
        tripId: existingTripId,
      }));
      const normalizedExpenses = (tripData.expenses ?? all[index].expenses ?? []).map((exp) => ({
        ...exp,
        tripId: existingTripId,
      }));
      const costBreakdown = calculateCostBreakdown(normalizedItems);
      const withinBudget = costBreakdown.totalInr <= tripData.budgetInr;
      const updated: TripRecord = {
        ...all[index],
        ...tripData,
        id: existingTripId,
        items: normalizedItems,
        expenses: normalizedExpenses,
        costBreakdown,
        estimatedTotalInr: costBreakdown.totalInr,
        withinBudget,
        updatedAt: now,
      };
      all[index] = updated;
      safeWriteJson(KEYS.trips, all, storage);
      return updated;
    }
  }

  const newId = generateId('trip');
  const normalizedItems: ItineraryItem[] = tripData.items.map((item) => ({
    ...item,
    tripId: newId,
  }));
  const normalizedExpenses = (tripData.expenses ?? []).map((exp) => ({
    ...exp,
    tripId: newId,
  }));
  const costBreakdown = calculateCostBreakdown(normalizedItems);
  const withinBudget = costBreakdown.totalInr <= tripData.budgetInr;

  const created: TripRecord = {
    ...tripData,
    id: newId,
    items: normalizedItems,
    expenses: normalizedExpenses,
    costBreakdown,
    estimatedTotalInr: costBreakdown.totalInr,
    withinBudget,
    createdAt: now,
    updatedAt: now,
  };

  safeWriteJson(KEYS.trips, [created, ...all], storage);
  return created;
}

export function deleteSavedTrip(tripId: string, storage?: StorageLike): void {
  const all = listSavedTrips(storage);
  safeWriteJson(
    KEYS.trips,
    all.filter((t) => t.id !== tripId),
    storage
  );
}

export function removeLocalTripsByIds(tripIds: string[], storage?: StorageLike): void {
  if (tripIds.length === 0) return;
  const removeSet = new Set(tripIds);
  const remaining = listSavedTrips(storage).filter((t) => !removeSet.has(t.id));
  safeWriteJson(KEYS.trips, remaining, storage);
}

export function listBookingRequests(storage?: StorageLike): BookingRequest[] {
  const all = safeReadJson<BookingRequest[]>(KEYS.enquiries, [], storage);
  if (!Array.isArray(all)) return [];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createBookingRequest(
  draft: BookingEnquiryDraft,
  contactName: string,
  contactEmail: string,
  specialNotes: string,
  storage?: StorageLike
): BookingRequest {
  const all = listBookingRequests(storage);
  const now = new Date().toISOString();

  const request: BookingRequest = {
    id: generateId('enq'),
    tripId: draft.tripId,
    itemType: draft.itemType,
    catalogId: draft.catalogId,
    itemName: draft.itemName,
    destinationName: draft.destinationName,
    providerName: draft.providerName,
    preferredDate: draft.preferredDate,
    durationUnits: draft.durationUnits,
    durationLabel: draft.durationLabel,
    travellers: draft.travellers,
    estimatedTotalInr: Math.max(0, Math.round(draft.estimatedTotalInr)),
    contactName: contactName.trim(),
    contactEmail: contactEmail.trim(),
    specialNotes: specialNotes.trim(),
    status: 'requested',
    confirmationNotice: UNCONFIRMED_ENQUIRY_NOTICE,
    createdAt: now,
    updatedAt: now,
    provenance: SAMPLE_PROVENANCE,
  };

  safeWriteJson(KEYS.enquiries, [request, ...all], storage);
  return request;
}
