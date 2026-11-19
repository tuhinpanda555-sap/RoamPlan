import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { SAMPLE_PROVENANCE, UNCONFIRMED_ENQUIRY_NOTICE } from '../data/sampleCatalogue';
import { getDeterministicItemExpenseId } from '../engine/expenseEngine';
import { calculateCostBreakdown } from '../engine/itineraryEngine';
import {
  BookingEnquiryDraft,
  BookingRequest,
  ExpenseCategory,
  ItineraryItem,
  TripExpense,
  TripRecord,
} from '../types/roamplan';
import { OperationType, db, handleFirestoreError } from './firebase';
import { filterUnmigratedLocalTrips } from '../utils/migration';

export { filterUnmigratedLocalTrips };

function sanitizeId(raw: string, prefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 110);
  if (cleaned.length >= 1) return cleaned;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampString(value: string | undefined | null, maxLen: number, fallback = ''): string {
  const trimmed = (value ?? '').trim();
  const text = trimmed.length > 0 ? trimmed : fallback.trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return new Date().toISOString();
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number.isFinite(value) ? value : min);
  return Math.min(max, Math.max(min, n));
}

function clampNumber(value: number | undefined, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Ensures /users/{uid} exists with blueprint-compliant fields before private subcollection writes.
 */
export async function upsertUserProfile(firebaseUser: User): Promise<void> {
  const uid = firebaseUser.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const displayName = clampString(
    firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'RoamPlan Traveller',
    100,
    'RoamPlan Traveller'
  );
  const email = clampString(firebaseUser.email || '', 254);
  const photoURL = clampString(firebaseUser.photoURL || '', 500);

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName,
        email,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        email,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

function buildItemPayload(
  uid: string,
  tripId: string,
  item: ItineraryItem,
  index: number
) {
  const itemId = sanitizeId(item.id, `item-${index + 1}`);
  const difficulty =
    item.difficulty === 'Easy' ||
    item.difficulty === 'Moderate' ||
    item.difficulty === 'Challenging'
      ? item.difficulty
      : '';

  return {
    id: itemId,
    tripId,
    ownerUid: uid,
    dayNumber: clampInt(item.dayNumber, 1, 14),
    order: clampInt(item.order || index + 1, 1, 100),
    itemType: item.itemType,
    costCategory: item.costCategory,
    catalogId: clampString(item.catalogId, 128),
    destinationId: sanitizeId(item.destinationId, 'manali').slice(0, 64),
    destinationName: clampString(item.destinationName, 100, 'Himachal'),
    title: clampString(item.title, 160, 'Itinerary Item'),
    subtitle: clampString(item.subtitle, 220),
    notes: clampString(item.notes, 1000),
    estimatedTravelTimeLabel: clampString(item.estimatedTravelTimeLabel, 100, 'Local transit'),
    unitCostInr: clampInt(item.unitCostInr, 0, 5000000),
    quantity: clampInt(item.quantity, 1, 50),
    quantityLabel: clampString(item.quantityLabel, 120, '1 unit'),
    estimatedCostInr: clampInt(item.estimatedCostInr, 0, 50000000),
    completed: Boolean(item.completed),
    durationHours: clampNumber(item.durationHours, 0, 48),
    seasonNotes: clampString(item.seasonNotes, 400),
    difficulty,
    safetyNotes: clampString(item.safetyNotes, 800),
    providerName: clampString(item.providerName, 160),
    provenance: clampString(item.provenance || SAMPLE_PROVENANCE, 300),
  };
}

const VALID_EXPENSE_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set([
  'accommodation',
  'transportation',
  'activities',
  'food',
  'parking',
  'shopping',
  'miscellaneous',
]);

export function buildExpensePayload(
  uid: string,
  tripId: string,
  expense: TripExpense
) {
  const kind: 'itinerary_item' | 'additional' =
    expense.kind === 'itinerary_item' && expense.itineraryItemId ? 'itinerary_item' : 'additional';
  const itineraryItemId =
    kind === 'itinerary_item' ? sanitizeId(expense.itineraryItemId ?? '', 'item') : '';
  const expenseId =
    kind === 'itinerary_item'
      ? sanitizeId(getDeterministicItemExpenseId(itineraryItemId), 'exp-item')
      : sanitizeId(expense.id, 'exp-extra');
  const category: ExpenseCategory = VALID_EXPENSE_CATEGORIES.has(expense.category)
    ? expense.category
    : 'miscellaneous';
  const expenseDate = /^\d{4}-\d{2}-\d{2}$/.test(expense.expenseDate)
    ? expense.expenseDate
    : new Date().toISOString().slice(0, 10);

  return {
    id: expenseId,
    tripId,
    ownerUid: uid,
    kind,
    itineraryItemId,
    description: clampString(expense.description, 160, 'Trip Expense'),
    category,
    amountInr: clampInt(expense.amountInr, 0, 50000000),
    expenseDate,
    notes: clampString(expense.notes, 300),
  };
}

/**
 * Loads all saved trips and their subcollection itinerary items for the authenticated user.
 */
export async function fetchUserTrips(uid: string): Promise<TripRecord[]> {
  const tripsPath = `users/${uid}/trips`;
  try {
    const tripsQuery = query(
      collection(db, 'users', uid, 'trips'),
      where('ownerUid', '==', uid)
    );
    const tripsSnap = await getDocs(tripsQuery);

    const records: TripRecord[] = await Promise.all(
      tripsSnap.docs.map(async (tripDoc) => {
        const data = tripDoc.data();
        const tripId = tripDoc.id;
        const itemsPath = `users/${uid}/trips/${tripId}/items`;
        const expensesPath = `users/${uid}/trips/${tripId}/expenses`;

        const [items, expenses] = await Promise.all([
          (async (): Promise<ItineraryItem[]> => {
            try {
              const itemsQuery = query(
                collection(db, 'users', uid, 'trips', tripId, 'items'),
                where('ownerUid', '==', uid),
                where('tripId', '==', tripId)
              );
              const itemsSnap = await getDocs(itemsQuery);
              return itemsSnap.docs
                .map((itemDoc) => {
                  const d = itemDoc.data();
                  return {
                    id: itemDoc.id,
                    tripId,
                    ownerUid: uid,
                    dayNumber: Number(d.dayNumber) || 1,
                    order: Number(d.order) || 1,
                    itemType: d.itemType,
                    costCategory: d.costCategory,
                    catalogId: d.catalogId || undefined,
                    destinationId: d.destinationId,
                    destinationName: d.destinationName,
                    title: d.title,
                    subtitle: d.subtitle || '',
                    notes: d.notes || '',
                    estimatedTravelTimeLabel: d.estimatedTravelTimeLabel || 'Local transit',
                    unitCostInr: Number(d.unitCostInr) || 0,
                    quantity: Number(d.quantity) || 1,
                    quantityLabel: d.quantityLabel || '',
                    estimatedCostInr: Number(d.estimatedCostInr) || 0,
                    completed: Boolean(d.completed),
                    durationHours:
                      typeof d.durationHours === 'number' && d.durationHours > 0
                        ? d.durationHours
                        : undefined,
                    seasonNotes: d.seasonNotes || undefined,
                    difficulty: d.difficulty || undefined,
                    safetyNotes: d.safetyNotes || undefined,
                    providerName: d.providerName || undefined,
                    provenance: d.provenance || SAMPLE_PROVENANCE,
                  } as ItineraryItem;
                })
                .sort((a, b) => a.dayNumber - b.dayNumber || a.order - b.order);
            } catch (itemErr) {
              handleFirestoreError(itemErr, OperationType.LIST, itemsPath);
            }
          })(),
          (async (): Promise<TripExpense[]> => {
            try {
              const expensesQuery = query(
                collection(db, 'users', uid, 'trips', tripId, 'expenses'),
                where('ownerUid', '==', uid),
                where('tripId', '==', tripId)
              );
              const expensesSnap = await getDocs(expensesQuery);
              return expensesSnap.docs
                .map((expDoc) => {
                  const e = expDoc.data();
                  return {
                    id: expDoc.id,
                    tripId,
                    ownerUid: uid,
                    kind: e.kind === 'itinerary_item' ? 'itinerary_item' : 'additional',
                    itineraryItemId: e.itineraryItemId || undefined,
                    description: e.description || 'Trip Expense',
                    category: VALID_EXPENSE_CATEGORIES.has(e.category)
                      ? e.category
                      : 'miscellaneous',
                    amountInr: Math.max(0, Math.round(Number(e.amountInr) || 0)),
                    expenseDate: e.expenseDate || data.startDate,
                    notes: e.notes || '',
                    createdAt: timestampToIso(e.createdAt),
                    updatedAt: timestampToIso(e.updatedAt),
                  } as TripExpense;
                })
                .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.updatedAt.localeCompare(a.updatedAt));
            } catch (expErr) {
              handleFirestoreError(expErr, OperationType.LIST, expensesPath);
            }
          })(),
        ]);

        const costBreakdown = calculateCostBreakdown(items);
        const budgetInr = Number(data.budgetInr) || 1500;
        const totalInr = items.length > 0 ? costBreakdown.totalInr : Number(data.estimatedTotalInr) || 0;

        return {
          id: tripId,
          ownerUid: uid,
          localSourceId: data.localSourceId || undefined,
          title: data.title || 'Saved India Trip',
          destinationId: data.destinationId,
          destinationName: data.destinationName,
          stopNames: Array.isArray(data.stopNames) && data.stopNames.length > 0 ? data.stopNames : [data.destinationName],
          startDate: data.startDate,
          days: Number(data.days) || 1,
          travellers: Number(data.travellers) || 1,
          budgetInr,
          intent: data.intent,
          style: data.style,
          interests: Array.isArray(data.interests) ? data.interests : [],
          items,
          expenses,
          costBreakdown:
            items.length > 0
              ? costBreakdown
              : {
                  accommodationInr: Number(data.accommodationInr) || 0,
                  transportationInr: Number(data.transportationInr) || 0,
                  activitiesInr: Number(data.activitiesInr) || 0,
                  foodInr: Number(data.foodInr) || 0,
                  totalInr,
                },
          estimatedTotalInr: totalInr,
          withinBudget: totalInr <= budgetInr,
          budgetExplanation: data.budgetExplanation || '',
          status: data.status === 'archived' ? 'archived' : data.status === 'draft' ? 'draft' : 'planned',
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
          provenance: data.provenance || SAMPLE_PROVENANCE,
        } as TripRecord;
      })
    );

    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, tripsPath);
  }
}

/**
 * Creates or updates a user's trip and synchronizes its items subcollection atomically.
 */
export async function saveUserTripToFirestore(
  uid: string,
  tripData: Omit<
    TripRecord,
    'id' | 'ownerUid' | 'createdAt' | 'updatedAt' | 'costBreakdown' | 'estimatedTotalInr' | 'withinBudget'
  >,
  existingTripId?: string
): Promise<TripRecord> {
  const isUpdate = Boolean(existingTripId);
  const tripId = existingTripId
    ? sanitizeId(existingTripId, 'trip')
    : sanitizeId(`trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, 'trip');
  const tripPath = `users/${uid}/trips/${tripId}`;
  const tripRef = doc(db, 'users', uid, 'trips', tripId);

  const normalizedItems = tripData.items.map((item, idx) => {
    const built = buildItemPayload(uid, tripId, item, idx);
    return {
      ...item,
      id: built.id,
      tripId,
      ownerUid: uid,
      order: built.order,
      estimatedCostInr: built.estimatedCostInr,
      unitCostInr: built.unitCostInr,
      quantity: built.quantity,
    };
  });

  const normalizedExpenses: TripExpense[] = (tripData.expenses ?? []).map((exp) => {
    const built = buildExpensePayload(uid, tripId, exp);
    return {
      ...exp,
      id: built.id,
      tripId,
      ownerUid: uid,
      kind: built.kind,
      itineraryItemId: built.itineraryItemId || undefined,
      description: built.description,
      category: built.category,
      amountInr: built.amountInr,
      expenseDate: built.expenseDate,
      notes: built.notes,
    };
  });

  const breakdown = calculateCostBreakdown(normalizedItems);
  const budgetInr = clampInt(tripData.budgetInr, 1500, 5000000);
  const withinBudget = breakdown.totalInr <= budgetInr;
  const cleanTitle = clampString(tripData.title || `${tripData.destinationName} Trip`, 140, 'India Trip');
  const cleanBudgetExplanation = clampString(tripData.budgetExplanation, 500);
  const cleanStatus: 'draft' | 'planned' | 'archived' =
    tripData.status === 'archived' ? 'archived' : 'planned';

  try {
    const batch = writeBatch(db);

    if (!isUpdate) {
      const stopNames = (tripData.stopNames.length > 0 ? tripData.stopNames : [tripData.destinationName])
        .slice(0, 5)
        .map((s) => clampString(s, 80, 'India'));
      const interests = (tripData.interests ?? []).slice(0, 10).map((tag) => clampString(tag, 50));

      batch.set(tripRef, {
        id: tripId,
        ownerUid: uid,
        localSourceId: clampString(tripData.localSourceId, 128),
        title: cleanTitle,
        destinationId: sanitizeId(tripData.destinationId, 'destination').slice(0, 64),
        destinationName: clampString(tripData.destinationName, 100, 'India'),
        stopNames,
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(tripData.startDate)
          ? tripData.startDate
          : new Date().toISOString().slice(0, 10),
        days: clampInt(tripData.days, 1, 14),
        travellers: clampInt(tripData.travellers, 1, 12),
        budgetInr,
        intent: tripData.intent,
        style: tripData.style,
        interests,
        accommodationInr: breakdown.accommodationInr,
        transportationInr: breakdown.transportationInr,
        activitiesInr: breakdown.activitiesInr,
        foodInr: breakdown.foodInr,
        estimatedTotalInr: breakdown.totalInr,
        withinBudget,
        budgetExplanation: cleanBudgetExplanation,
        status: cleanStatus,
        provenance: clampString(tripData.provenance || SAMPLE_PROVENANCE, 300),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      normalizedItems.forEach((item, idx) => {
        const payload = buildItemPayload(uid, tripId, item, idx);
        const itemRef = doc(db, 'users', uid, 'trips', tripId, 'items', payload.id);
        batch.set(itemRef, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      // Persist any expenses recorded before initial save (or during migration)
      const seenExpenseIds = new Set<string>();
      normalizedExpenses.forEach((exp) => {
        const payload = buildExpensePayload(uid, tripId, exp);
        if (seenExpenseIds.has(payload.id)) return;
        seenExpenseIds.add(payload.id);
        const expRef = doc(db, 'users', uid, 'trips', tripId, 'expenses', payload.id);
        batch.set(expRef, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    } else {
      // Update only allowed mutable keys on existing trip document (never touches createdAt or ownerUid)
      batch.update(tripRef, {
        title: cleanTitle,
        accommodationInr: breakdown.accommodationInr,
        transportationInr: breakdown.transportationInr,
        activitiesInr: breakdown.activitiesInr,
        foodInr: breakdown.foodInr,
        estimatedTotalInr: breakdown.totalInr,
        withinBudget,
        budgetExplanation: cleanBudgetExplanation,
        status: cleanStatus,
        updatedAt: serverTimestamp(),
      });

      // Diff subcollection items cleanly so existing items update without overwriting createdAt
      const existingItemsQuery = query(
        collection(db, 'users', uid, 'trips', tripId, 'items'),
        where('ownerUid', '==', uid),
        where('tripId', '==', tripId)
      );
      const existingSnap = await getDocs(existingItemsQuery);
      const existingIds = new Set(existingSnap.docs.map((d) => d.id));
      const nextIds = new Set(normalizedItems.map((i) => i.id));

      // Delete removed items and any linked itinerary_item expenses whose parent item was removed
      const removedItemIds = new Set<string>();
      for (const existingDoc of existingSnap.docs) {
        if (!nextIds.has(existingDoc.id)) {
          batch.delete(existingDoc.ref);
          removedItemIds.add(existingDoc.id);
        }
      }

      if (removedItemIds.size > 0) {
        const existingExpensesQuery = query(
          collection(db, 'users', uid, 'trips', tripId, 'expenses'),
          where('ownerUid', '==', uid),
          where('tripId', '==', tripId)
        );
        const existingExpSnap = await getDocs(existingExpensesQuery);
        for (const expDoc of existingExpSnap.docs) {
          const data = expDoc.data();
          if (data.kind === 'itinerary_item' && removedItemIds.has(String(data.itineraryItemId))) {
            batch.delete(expDoc.ref);
          }
        }
      }

      // Create new items or update existing items
      normalizedItems.forEach((item, idx) => {
        const payload = buildItemPayload(uid, tripId, item, idx);
        const itemRef = doc(db, 'users', uid, 'trips', tripId, 'items', payload.id);
        if (existingIds.has(payload.id)) {
          batch.update(itemRef, {
            catalogId: payload.catalogId,
            destinationId: payload.destinationId,
            destinationName: payload.destinationName,
            title: payload.title,
            subtitle: payload.subtitle,
            notes: payload.notes,
            estimatedTravelTimeLabel: payload.estimatedTravelTimeLabel,
            unitCostInr: payload.unitCostInr,
            quantity: payload.quantity,
            quantityLabel: payload.quantityLabel,
            estimatedCostInr: payload.estimatedCostInr,
            durationHours: payload.durationHours,
            seasonNotes: payload.seasonNotes,
            difficulty: payload.difficulty,
            safetyNotes: payload.safetyNotes,
            providerName: payload.providerName,
            provenance: payload.provenance,
            order: payload.order,
            completed: payload.completed,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(itemRef, {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
    }

    await batch.commit();

    const nowIso = new Date().toISOString();
    const survivingItemIds = new Set(normalizedItems.map((i) => i.id));
    const finalExpenses = normalizedExpenses.filter(
      (exp) =>
        exp.kind !== 'itinerary_item' ||
        !exp.itineraryItemId ||
        survivingItemIds.has(exp.itineraryItemId)
    );

    return {
      ...tripData,
      id: tripId,
      ownerUid: uid,
      title: cleanTitle,
      items: normalizedItems,
      expenses: finalExpenses,
      costBreakdown: breakdown,
      estimatedTotalInr: breakdown.totalInr,
      withinBudget,
      budgetExplanation: cleanBudgetExplanation,
      status: cleanStatus,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, isUpdate ? OperationType.UPDATE : OperationType.CREATE, tripPath);
  }
}

/**
 * Creates or updates a single actual expenditure record under /users/{uid}/trips/{tripId}/expenses/{expenseId}.
 * Preserves createdAt and immutable link fields on update and guarantees zero duplication.
 */
export async function upsertTripExpenseInFirestore(
  uid: string,
  tripId: string,
  expense: TripExpense
): Promise<TripExpense> {
  const safeTripId = sanitizeId(tripId, 'trip');
  const payload = buildExpensePayload(uid, safeTripId, expense);
  const expensePath = `users/${uid}/trips/${safeTripId}/expenses/${payload.id}`;
  const expenseRef = doc(db, 'users', uid, 'trips', safeTripId, 'expenses', payload.id);

  let currentOp: OperationType = OperationType.GET;
  try {
    const existingSnap = await getDoc(expenseRef);
    const nowIso = new Date().toISOString();

    if (existingSnap.exists()) {
      currentOp = OperationType.UPDATE;
      await updateDoc(expenseRef, {
        description: payload.description,
        category: payload.category,
        amountInr: payload.amountInr,
        expenseDate: payload.expenseDate,
        notes: payload.notes,
        updatedAt: serverTimestamp(),
      });
      return {
        ...payload,
        itineraryItemId: payload.itineraryItemId || undefined,
        createdAt: timestampToIso(existingSnap.data().createdAt),
        updatedAt: nowIso,
      };
    }

    currentOp = OperationType.CREATE;
    await setDoc(expenseRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      ...payload,
      itineraryItemId: payload.itineraryItemId || undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, currentOp, expensePath);
  }
}

/**
 * Deletes a single actual expenditure record from /users/{uid}/trips/{tripId}/expenses/{expenseId}.
 */
export async function deleteTripExpenseFromFirestore(
  uid: string,
  tripId: string,
  expenseId: string
): Promise<void> {
  const safeTripId = sanitizeId(tripId, 'trip');
  const safeExpenseId = sanitizeId(expenseId, 'exp');
  const expensePath = `users/${uid}/trips/${safeTripId}/expenses/${safeExpenseId}`;

  try {
    await deleteDoc(doc(db, 'users', uid, 'trips', safeTripId, 'expenses', safeExpenseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, expensePath);
  }
}

/**
 * Deletes a user's trip along with all its subcollection itinerary items and expenses in one atomic batch.
 */
export async function deleteUserTripFromFirestore(uid: string, tripId: string): Promise<void> {
  const tripPath = `users/${uid}/trips/${tripId}`;
  try {
    const itemsQuery = query(
      collection(db, 'users', uid, 'trips', tripId, 'items'),
      where('ownerUid', '==', uid),
      where('tripId', '==', tripId)
    );
    const expensesQuery = query(
      collection(db, 'users', uid, 'trips', tripId, 'expenses'),
      where('ownerUid', '==', uid),
      where('tripId', '==', tripId)
    );
    const [itemsSnap, expensesSnap] = await Promise.all([
      getDocs(itemsQuery),
      getDocs(expensesQuery),
    ]);

    const batch = writeBatch(db);
    itemsSnap.docs.forEach((d) => batch.delete(d.ref));
    expensesSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'users', uid, 'trips', tripId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, tripPath);
  }
}

/**
 * Lists unconfirmed sample booking enquiries owned by the authenticated user.
 */
export async function fetchUserBookingRequests(uid: string): Promise<BookingRequest[]> {
  const path = `users/${uid}/bookingRequests`;
  try {
    const q = query(
      collection(db, 'users', uid, 'bookingRequests'),
      where('ownerUid', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerUid: uid,
          tripId: data.tripId || undefined,
          itemType: data.itemType,
          catalogId: data.catalogId,
          itemName: data.itemName,
          destinationName: data.destinationName,
          providerName: data.providerName,
          preferredDate: data.preferredDate,
          durationUnits: Number(data.durationUnits) || 1,
          durationLabel: data.durationLabel || '',
          travellers: Number(data.travellers) || 1,
          estimatedTotalInr: Number(data.estimatedTotalInr) || 0,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          specialNotes: data.specialNotes || '',
          status: 'requested',
          confirmationNotice: data.confirmationNotice || UNCONFIRMED_ENQUIRY_NOTICE,
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
          provenance: data.provenance || SAMPLE_PROVENANCE,
        } as BookingRequest;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Creates a strictly unconfirmed (status='requested') sample booking enquiry in Firestore.
 */
export async function createUserBookingRequestInFirestore(
  uid: string,
  draft: BookingEnquiryDraft,
  contactName: string,
  contactEmail: string,
  specialNotes: string
): Promise<BookingRequest> {
  const requestId = sanitizeId(
    `enq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    'enq'
  );
  const path = `users/${uid}/bookingRequests/${requestId}`;
  const reqRef = doc(db, 'users', uid, 'bookingRequests', requestId);

  const payload = {
    id: requestId,
    ownerUid: uid,
    tripId: clampString(draft.tripId, 128),
    itemType: draft.itemType,
    catalogId: sanitizeId(draft.catalogId, 'item'),
    itemName: clampString(draft.itemName, 160, 'Sample Listing'),
    destinationName: clampString(draft.destinationName, 100, 'Himachal'),
    providerName: clampString(draft.providerName, 160, 'Sample Provider'),
    preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(draft.preferredDate)
      ? draft.preferredDate
      : new Date().toISOString().slice(0, 10),
    durationUnits: clampNumber(draft.durationUnits, 0.5, 30),
    durationLabel: clampString(draft.durationLabel, 100, '1 unit'),
    travellers: clampInt(draft.travellers, 1, 12),
    estimatedTotalInr: clampInt(draft.estimatedTotalInr, 0, 50000000),
    contactName: clampString(contactName, 100, 'Traveller'),
    contactEmail: clampString(contactEmail, 254),
    specialNotes: clampString(specialNotes, 800),
    status: 'requested' as const,
    confirmationNotice: clampString(UNCONFIRMED_ENQUIRY_NOTICE, 300),
    provenance: clampString(SAMPLE_PROVENANCE, 300),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(reqRef, payload);
    const nowIso = new Date().toISOString();
    return {
      ...payload,
      tripId: payload.tripId || undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Migrates unmigrated localStorage trips to Cloud Firestore without duplicating records.
 */
export async function migrateLocalTripsToFirestore(
  uid: string,
  localTrips: TripRecord[],
  existingCloudTrips: TripRecord[]
): Promise<{ migratedIds: string[]; skippedCount: number }> {
  const toMigrate = filterUnmigratedLocalTrips(localTrips, existingCloudTrips);
  const skippedCount = localTrips.length - toMigrate.length;
  const migratedIds: string[] = [];

  for (const local of toMigrate) {
    await saveUserTripToFirestore(uid, {
      localSourceId: local.id,
      title: local.title,
      destinationId: local.destinationId,
      destinationName: local.destinationName,
      stopNames: local.stopNames,
      startDate: local.startDate,
      days: local.days,
      travellers: local.travellers,
      budgetInr: local.budgetInr,
      intent: local.intent,
      style: local.style,
      interests: local.interests,
      items: local.items,
      expenses: local.expenses ?? [],
      budgetExplanation: local.budgetExplanation,
      status: local.status === 'archived' ? 'archived' : 'planned',
      provenance: local.provenance || SAMPLE_PROVENANCE,
    });
    migratedIds.push(local.id);
  }

  return { migratedIds, skippedCount };
}
