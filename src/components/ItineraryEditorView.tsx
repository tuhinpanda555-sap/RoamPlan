import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkCheck,
  Check,
  Clock,
  IndianRupee,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  EXPERIENCES,
  SAMPLE_PROVENANCE,
  TRAVEL_INTENT_META,
  getDestinationById,
} from '../data/sampleCatalogue';
import {
  EXPENSE_CATEGORY_OPTIONS,
  computeDateForTripDay,
  computeItemExpenseVariance,
  computeTripFinancialSummary,
  createAdditionalExpenseId,
  findExpenseForItem,
  formatExpenseCategoryLabel,
  formatTripDateRange,
  getDeterministicItemExpenseId,
  mapCostCategoryToExpenseCategory,
  sanitizeExpenseAmount,
} from '../engine/expenseEngine';
import {
  ReplacementOption,
  applyItemReplacement,
  calculateCostBreakdown,
  computeCompletionProgress,
  createActivityItineraryItem,
  createPoiItineraryItem,
  formatInr,
  getReplacementCatalogOptions,
  recalculateItineraryTotal,
} from '../engine/itineraryEngine';
import { formatPoiCategoryLabel } from '../services/geospatialDiscoveryService';
import {
  AuthUserProfile,
  BookingEnquiryDraft,
  DestinationDiscoveryResult,
  DiscoveredPoi,
  ExpenseCategory,
  ItineraryItem,
  TripExpense,
  TripRecord,
} from '../types/roamplan';

interface ItineraryEditorViewProps {
  trip: TripRecord;
  discovery?: DestinationDiscoveryResult | null;
  isSaved: boolean;
  user: AuthUserProfile | null;
  authBusy: boolean;
  isSaving: boolean;
  onBack: () => void;
  onChangeTrip: (updated: TripRecord, options?: { syncToCloud?: boolean }) => void;
  onSaveTrip: (tripToSave: TripRecord) => Promise<void>;
  onSaveExpense: (expense: TripExpense) => Promise<void>;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  onSignInForSave: () => void;
  onRequestEnquiry: (draft: BookingEnquiryDraft) => void;
}

interface ItemExpenseDraft {
  itemId: string;
  amountText: string;
  expenseDate: string;
  notes: string;
  fromCompletionPrompt: boolean;
  error: string | null;
}

interface AdditionalExpenseDraft {
  id: string | null;
  description: string;
  category: ExpenseCategory;
  amountText: string;
  expenseDate: string;
  notes: string;
  error: string | null;
}

export function ItineraryEditorView({
  trip,
  discovery = null,
  isSaved,
  user,
  authBusy,
  isSaving,
  onBack,
  onChangeTrip,
  onSaveTrip,
  onSaveExpense,
  onDeleteExpense,
  onSignInForSave,
  onRequestEnquiry,
}: ItineraryEditorViewProps) {
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null);
  const [addingToDay, setAddingToDay] = useState<number | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [titleDirty, setTitleDirty] = useState(false);

  // Per-item actual expense inline editor state
  const [itemExpenseDraft, setItemExpenseDraft] = useState<ItemExpenseDraft | null>(null);
  const [expenseSavingId, setExpenseSavingId] = useState<string | null>(null);

  // Additional unplanned expenses form state
  const [additionalForm, setAdditionalForm] = useState<AdditionalExpenseDraft | null>(null);

  useEffect(() => {
    setTitleDirty(false);
    setSaveFeedback(null);
    setReplacingItemId(null);
    setAddingToDay(null);
    setItemExpenseDraft(null);
    setAdditionalForm(null);
  }, [trip.id]);

  const matchingDiscovery =
    discovery && discovery.destination.id === trip.destinationId ? discovery : null;

  const costBreakdown = useMemo(() => calculateCostBreakdown(trip.items), [trip.items]);
  const computedTotal = costBreakdown.totalInr;
  const progress = useMemo(() => computeCompletionProgress(trip.items), [trip.items]);
  const finance = useMemo(
    () =>
      computeTripFinancialSummary({
        items: trip.items,
        estimatedTotalInr: computedTotal,
        travellers: trip.travellers,
        expenses: trip.expenses ?? [],
      }),
    [trip.items, computedTotal, trip.travellers, trip.expenses]
  );
  const isArchived = trip.status === 'archived';
  const dateRange = useMemo(
    () => formatTripDateRange(trip.startDate, trip.days),
    [trip.startDate, trip.days]
  );

  const additionalExpenses = useMemo(
    () =>
      (trip.expenses ?? [])
        .filter((e) => e.kind === 'additional')
        .sort(
          (a, b) =>
            b.expenseDate.localeCompare(a.expenseDate) || b.updatedAt.localeCompare(a.updatedAt)
        ),
    [trip.expenses]
  );

  const daysList = useMemo(
    () => Array.from({ length: trip.days }, (_, idx) => idx + 1),
    [trip.days]
  );

  const replacingItem = useMemo(
    () => trip.items.find((i) => i.id === replacingItemId) ?? null,
    [trip.items, replacingItemId]
  );

  const replacementChoices = useMemo(
    () => (replacingItem ? getReplacementCatalogOptions(replacingItem, matchingDiscovery) : []),
    [replacingItem, matchingDiscovery]
  );

  const commitItems = (nextItems: ItineraryItem[]) => {
    if (isArchived) return;
    const nextBreakdown = calculateCostBreakdown(nextItems);
    const nextTotal = nextBreakdown.totalInr;
    const nextWithin = nextTotal <= trip.budgetInr;
    const survivingItemIds = new Set(nextItems.map((i) => i.id));
    const nextExpenses = (trip.expenses ?? []).filter(
      (exp) =>
        exp.kind !== 'itinerary_item' ||
        !exp.itineraryItemId ||
        survivingItemIds.has(exp.itineraryItemId)
    );

    const updated: TripRecord = {
      ...trip,
      items: nextItems,
      expenses: nextExpenses,
      costBreakdown: nextBreakdown,
      estimatedTotalInr: nextTotal,
      withinBudget: nextWithin,
      status: isSaved ? 'planned' : 'draft',
    };
    onChangeTrip(updated, { syncToCloud: Boolean(isSaved && user) });
    setSaveFeedback(
      isSaved && user
        ? 'Synced changes to Cloud Firestore.'
        : 'Totals updated. Sign in and save to store in Cloud Firestore.'
    );
  };

  const openItemExpenseEditor = (item: ItineraryItem, fromCompletionPrompt: boolean) => {
    if (isArchived) return;
    const existing = findExpenseForItem(trip.expenses, item.id);
    const defaultDate = computeDateForTripDay(trip.startDate, item.dayNumber);
    setItemExpenseDraft({
      itemId: item.id,
      amountText: existing ? String(existing.amountInr) : '',
      expenseDate: existing?.expenseDate || defaultDate,
      notes: existing?.notes || '',
      fromCompletionPrompt,
      error: null,
    });
    setReplacingItemId(null);
  };

  const handleToggleCompleted = (item: ItineraryItem) => {
    if (isArchived) return;
    const willBeCompleted = !item.completed;
    const nextItems = trip.items.map((entry) =>
      entry.id === item.id ? { ...entry, completed: willBeCompleted } : entry
    );
    commitItems(nextItems);

    // Gently prompt for actual expenditure only when marking completed and no expense is recorded yet.
    // Never auto-add or auto-charge expenditure on completion.
    const existing = findExpenseForItem(trip.expenses, item.id);
    if (willBeCompleted && !existing) {
      openItemExpenseEditor(item, true);
    }
  };

  const handleSubmitItemExpense = async (item: ItineraryItem) => {
    if (!itemExpenseDraft || itemExpenseDraft.itemId !== item.id || isArchived) return;
    const parsedAmount = sanitizeExpenseAmount(itemExpenseDraft.amountText);
    if (parsedAmount === null) {
      setItemExpenseDraft((prev) =>
        prev
          ? {
              ...prev,
              error: 'Enter a valid non-negative amount in ₹ (0 is allowed for zero-cost activities).',
            }
          : null
      );
      return;
    }

    const existing = findExpenseForItem(trip.expenses, item.id);
    const nowIso = new Date().toISOString();
    const expenseId = existing?.id || getDeterministicItemExpenseId(item.id);
    const expenseDate = /^\d{4}-\d{2}-\d{2}$/.test(itemExpenseDraft.expenseDate)
      ? itemExpenseDraft.expenseDate
      : computeDateForTripDay(trip.startDate, item.dayNumber);

    const record: TripExpense = {
      id: expenseId,
      tripId: trip.id,
      ownerUid: user?.uid,
      kind: 'itinerary_item',
      itineraryItemId: item.id,
      description: item.title,
      category: mapCostCategoryToExpenseCategory(item.costCategory),
      amountInr: parsedAmount,
      expenseDate,
      notes: itemExpenseDraft.notes.trim(),
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    setExpenseSavingId(expenseId);
    try {
      await onSaveExpense(record);
      setItemExpenseDraft(null);
      setSaveFeedback(
        isSaved && user
          ? `Recorded actual expense (${formatInr(parsedAmount)}) in Cloud Firestore.`
          : `Recorded actual expense (${formatInr(parsedAmount)}). Save trip to sync to Cloud Firestore.`
      );
    } catch {
      // Error surfaced cleanly via App error banner
    } finally {
      setExpenseSavingId(null);
    }
  };

  const handleDeleteItemExpense = async (expense: TripExpense) => {
    if (isArchived) return;
    setExpenseSavingId(expense.id);
    try {
      await onDeleteExpense(expense.id);
      if (itemExpenseDraft?.itemId === expense.itineraryItemId) {
        setItemExpenseDraft(null);
      }
      setSaveFeedback(
        isSaved && user
          ? 'Removed recorded expense from Cloud Firestore.'
          : 'Removed recorded expense.'
      );
    } catch {
      // Error surfaced cleanly via App error banner
    } finally {
      setExpenseSavingId(null);
    }
  };

  const openNewAdditionalForm = () => {
    if (isArchived) return;
    setAdditionalForm({
      id: null,
      description: '',
      category: 'food',
      amountText: '',
      expenseDate: trip.startDate || new Date().toISOString().slice(0, 10),
      notes: '',
      error: null,
    });
  };

  const openEditAdditionalForm = (expense: TripExpense) => {
    if (isArchived) return;
    setAdditionalForm({
      id: expense.id,
      description: expense.description,
      category: expense.category,
      amountText: String(expense.amountInr),
      expenseDate: expense.expenseDate,
      notes: expense.notes || '',
      error: null,
    });
  };

  const handleSubmitAdditionalExpense = async () => {
    if (!additionalForm || isArchived) return;
    const description = additionalForm.description.trim();
    if (description.length < 2) {
      setAdditionalForm((prev) =>
        prev ? { ...prev, error: 'Enter a short description (at least 2 characters).' } : null
      );
      return;
    }

    const parsedAmount = sanitizeExpenseAmount(additionalForm.amountText);
    if (parsedAmount === null) {
      setAdditionalForm((prev) =>
        prev ? { ...prev, error: 'Enter a valid non-negative amount in ₹.' } : null
      );
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(additionalForm.expenseDate)) {
      setAdditionalForm((prev) =>
        prev ? { ...prev, error: 'Choose a valid expense date.' } : null
      );
      return;
    }

    const existing = additionalForm.id
      ? (trip.expenses ?? []).find((e) => e.id === additionalForm.id)
      : undefined;
    const nowIso = new Date().toISOString();
    const expenseId = existing?.id || createAdditionalExpenseId();

    const record: TripExpense = {
      id: expenseId,
      tripId: trip.id,
      ownerUid: user?.uid,
      kind: 'additional',
      description,
      category: additionalForm.category,
      amountInr: parsedAmount,
      expenseDate: additionalForm.expenseDate,
      notes: additionalForm.notes.trim(),
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    setExpenseSavingId(expenseId);
    try {
      await onSaveExpense(record);
      setAdditionalForm(null);
      setSaveFeedback(
        isSaved && user
          ? `${existing ? 'Updated' : 'Added'} additional expense (${formatInr(
              parsedAmount
            )}) in Cloud Firestore.`
          : `${existing ? 'Updated' : 'Added'} additional expense (${formatInr(
              parsedAmount
            )}). Save trip to sync to Cloud Firestore.`
      );
    } catch {
      // Error surfaced cleanly via App error banner
    } finally {
      setExpenseSavingId(null);
    }
  };

  const handleRemoveItem = (itemId: string) => {
    const nextItems = trip.items.filter((item) => item.id !== itemId);
    commitItems(nextItems);
    if (replacingItemId === itemId) setReplacingItemId(null);
    if (itemExpenseDraft?.itemId === itemId) setItemExpenseDraft(null);
  };

  const handleApplyReplacement = (choice: ReplacementOption) => {
    if (!replacingItem) return;
    const nextItems = applyItemReplacement(trip.items, replacingItem.id, choice);
    commitItems(nextItems);
    setReplacingItemId(null);
  };

  const handleAddPoiToDay = (dayNumber: number, poi: DiscoveredPoi) => {
    const nextOrder = trip.items.filter((i) => i.dayNumber === dayNumber).length + 1;
    const newItem = createPoiItineraryItem(trip.id, dayNumber, trip.travellers, poi, nextOrder);
    commitItems([...trip.items, newItem]);
    setAddingToDay(null);
  };

  const handleAddSeedExperienceToDay = (dayNumber: number, expId: string) => {
    const exp = EXPERIENCES.find((e) => e.id === expId);
    if (!exp) return;
    const nextOrder = trip.items.filter((i) => i.dayNumber === dayNumber).length + 1;
    const newItem = createActivityItineraryItem(trip.id, dayNumber, trip.travellers, exp, nextOrder);
    commitItems([...trip.items, newItem]);
    setAddingToDay(null);
  };

  const handleAddPlanningBlockToDay = (
    dayNumber: number,
    kind: 'self_paced' | 'guided_local'
  ) => {
    const nextOrder = trip.items.filter((i) => i.dayNumber === dayNumber).length + 1;
    const isGuided = kind === 'guided_local';
    const unitCost = isGuided ? 1200 : 0;
    const newItem: ItineraryItem = {
      id: `custom-${kind}-${Date.now().toString(36)}`,
      tripId: trip.id,
      dayNumber,
      order: nextOrder,
      itemType: 'activity',
      costCategory: 'activities',
      catalogId: `est-${kind}-${trip.destinationId}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
      destinationId: trip.destinationId,
      destinationName: trip.destinationName,
      title: isGuided
        ? `Local Guided Orientation in ${trip.destinationName}`
        : `Self-Paced Local Exploration in ${trip.destinationName}`,
      subtitle: isGuided
        ? 'Estimated guided allowance · 3.5 hrs'
        : 'Flexible unguided window · 2.5 hrs',
      notes: isGuided
        ? 'Estimated budget allowance for hiring a verified local guide or joining a regional walk on arrival.'
        : 'Unscheduled window for local markets, regional cafes, or rest without fabricating unverified attractions.',
      estimatedTravelTimeLabel: isGuided ? 'Local transit (est.)' : 'Local walk',
      unitCostInr: unitCost,
      quantity: trip.travellers,
      quantityLabel:
        unitCost === 0
          ? 'No-cost self-paced block'
          : `${trip.travellers} ${trip.travellers === 1 ? 'traveller' : 'travellers'} × ${formatInr(
              unitCost
            )} est.`,
      estimatedCostInr: unitCost * trip.travellers,
      completed: false,
      durationHours: isGuided ? 3.5 : 2.5,
      providerName: isGuided ? 'Verify Local Guide on Arrival' : 'Self-Paced Planning Guidance',
      provenance: SAMPLE_PROVENANCE,
      dataOrigin: 'estimated_guidance',
    };
    commitItems([...trip.items, newItem]);
    setAddingToDay(null);
  };

  const handleSaveClick = async () => {
    if (!user) {
      onSignInForSave();
      return;
    }
    if (isArchived) return;
    setSaveFeedback(null);
    await onSaveTrip({
      ...trip,
      costBreakdown,
      estimatedTotalInr: computedTotal,
      withinBudget: computedTotal <= trip.budgetInr,
      status: 'planned',
    });
    setTitleDirty(false);
    setSaveFeedback('Saved to Cloud Firestore — accessible across your devices.');
  };

  const handleTitleBlur = () => {
    if (isSaved && user && titleDirty && !isSaving && !isArchived) {
      void handleSaveClick();
    }
  };

  const discoveredPois = useMemo(() => matchingDiscovery?.pois ?? [], [matchingDiscovery]);

  const matchingSeedExperiences = useMemo(() => {
    if (discoveredPois.length > 0) return [];
    const destSeed = getDestinationById(trip.destinationId);
    if (!destSeed) return [];
    return EXPERIENCES.filter(
      (e) => e.destinationId === destSeed.id && e.category !== 'transfer' && e.published
    );
  }, [discoveredPois.length, trip.destinationId]);

  const itemTypeLabel = (item: ItineraryItem): string => {
    switch (item.itemType) {
      case 'accommodation':
        return 'Accommodation';
      case 'transportation':
        return 'Transportation';
      case 'activity':
        return 'Activity & Landmark';
      case 'food':
        return 'Food';
      default:
        return 'Travel Advisory';
    }
  };

  const dataOriginLabel = (item: ItineraryItem): string | null => {
    if (item.dataOrigin === 'verified_osm') return 'Verified OSM Location';
    if (item.dataOrigin === 'estimated_guidance') return 'Estimated Guidance';
    if (item.dataOrigin === 'curated_seed') return 'Curated Example';
    return null;
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#4B5650] hover:text-[#17211C]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back</span>
        </button>

        <div className="flex flex-wrap items-center gap-3">
          {isSaving ? (
            <span className="inline-flex items-center gap-2 text-xs font-medium text-[#4B5650]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Syncing to Cloud Firestore…</span>
            </span>
          ) : saveFeedback ? (
            <span className="text-xs font-medium text-[#1B4B3A]">{saveFeedback}</span>
          ) : !user ? (
            <span className="text-xs text-[#4B5650]">
              Sign in with Google to save private itineraries and expenses to your cloud account.
            </span>
          ) : titleDirty && isSaved ? (
            <span className="text-xs font-medium text-[#8A5016]">Unsaved title edit</span>
          ) : null}

          {!isArchived && (
            <button
              type="button"
              disabled={isSaving || authBusy}
              onClick={() => void handleSaveClick()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
            >
              {isSaving || authBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : user ? (
                <BookmarkCheck className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Lock className="w-4 h-4" aria-hidden="true" />
              )}
              <span>
                {!user
                  ? authBusy
                    ? 'Signing in…'
                    : 'Sign in with Google to Save'
                  : isSaving
                  ? 'Saving…'
                  : isSaved
                  ? 'Save Changes'
                  : 'Save to My Trips'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Trip Header & Automatic Financial Summary */}
      <div className="mt-6 bg-white border border-[#DFD9CE] rounded-lg p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Editable Title, Metadata & Dual Independent Progress Bars */}
          <div className="lg:col-span-6">
            <p className="text-xs font-medium text-[#4B5650]">
              {TRAVEL_INTENT_META[trip.intent].label} ·{' '}
              {trip.style === 'budget_explorer'
                ? 'Budget Explorer'
                : trip.style === 'experience_seeker'
                ? 'Experience Seeker'
                : 'Luxury Traveller'}{' '}
              · {trip.stopNames.join(' → ')}
              {isSaved && user ? ' · Cloud Synced' : ''}
            </p>
            <label htmlFor="trip-title-input" className="sr-only">
              Trip title
            </label>
            <input
              id="trip-title-input"
              type="text"
              readOnly={isArchived}
              value={trip.title}
              onChange={(e) => {
                setTitleDirty(true);
                onChangeTrip({ ...trip, title: e.target.value }, { syncToCloud: false });
              }}
              onBlur={handleTitleBlur}
              className="mt-2 w-full font-editorial text-2xl sm:text-3xl text-[#17211C] bg-transparent border-b border-transparent hover:border-[#DFD9CE] focus:border-[#1B4B3A] focus:outline-none pb-1"
            />
            <p className="mt-2 text-xs text-[#4B5650] font-mono tabular-nums">
              {dateRange} · {trip.days} {trip.days === 1 ? 'day' : 'days'} · {trip.travellers}{' '}
              {trip.travellers === 1 ? 'traveller' : 'travellers'}
            </p>

            {/* Visually Separate Progress Bars: Budget Utilization vs Itinerary Completion */}
            <div className="mt-6 space-y-4 max-w-md">
              {/* Budget Utilization Bar */}
              <div>
                <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                  <span className="font-semibold text-[#17211C]">Budget Utilization</span>
                  <span
                    className={`font-mono tabular-nums ${
                      finance.isOverBudget ? 'font-semibold text-[#9B2C1B]' : 'text-[#4B5650]'
                    }`}
                  >
                    {formatInr(finance.actualTotalInr)} / {formatInr(finance.estimatedTotalInr)} (
                    {finance.budgetUtilizationPct}%)
                  </span>
                </div>
                <div
                  className="w-full h-2 bg-[#EFECE4] rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label="Budget utilization"
                  aria-valuenow={finance.budgetUtilizationPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full transition-all duration-200 ${
                      finance.isOverBudget
                        ? 'bg-[#9B2C1B]'
                        : finance.budgetUtilizationPct >= 85
                        ? 'bg-[#B46519]'
                        : 'bg-[#8A5016]'
                    }`}
                    style={{ width: `${finance.budgetUtilizationBarPct}%` }}
                  />
                </div>
              </div>

              {/* Itinerary Completion Bar */}
              <div>
                <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                  <span className="font-semibold text-[#17211C]">Itinerary Completion</span>
                  <span className="font-mono tabular-nums text-[#4B5650]">
                    {progress.completedCount}/{progress.totalCount} completed ({progress.percentage}
                    %)
                  </span>
                </div>
                <div
                  className="w-full h-2 bg-[#EFECE4] rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label="Itinerary completion"
                  aria-valuenow={progress.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-[#1B4B3A] transition-all duration-200"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[#4B5650]">
                  Completion and actual spending are tracked independently — marking an item done
                  does not add expenditure unless you record an amount.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Financial Summary Panel anchored to Estimated Total Trip Expenditure */}
          <div className="lg:col-span-6 bg-[#F8F6F1] border border-[#DFD9CE] rounded-md p-5">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DFD9CE]">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#4B5650]">
                Trip Financial Summary
              </h2>
              <span className="text-[11px] text-[#4B5650]">
                Baseline: Estimated Total Trip Cost
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-[#4B5650]">Estimated Total</p>
                <p className="mt-0.5 font-mono tabular-nums text-xl font-medium text-[#17211C]">
                  {formatInr(finance.estimatedTotalInr)}
                </p>
                <p className="mt-0.5 text-[11px] font-mono tabular-nums text-[#4B5650]">
                  {formatInr(finance.estimatedPerTravellerInr)} / traveller
                </p>
              </div>

              <div>
                <p className="text-xs text-[#4B5650]">Actual Spent</p>
                <p className="mt-0.5 font-mono tabular-nums text-xl font-medium text-[#17211C]">
                  {formatInr(finance.actualTotalInr)}
                </p>
                <p className="mt-0.5 text-[11px] font-mono tabular-nums text-[#4B5650]">
                  Items {formatInr(finance.itemizedActualInr)} · Extra{' '}
                  {formatInr(finance.additionalActualInr)}
                </p>
              </div>

              <div>
                <p className="text-xs text-[#4B5650]">
                  {finance.isOverBudget ? 'Over Estimated Budget' : 'Remaining Estimate'}
                </p>
                <p
                  className={`mt-0.5 font-mono tabular-nums text-xl font-medium ${
                    finance.isOverBudget ? 'text-[#9B2C1B]' : 'text-[#1B4B3A]'
                  }`}
                >
                  {finance.isOverBudget
                    ? `-${formatInr(finance.overBudgetInr)}`
                    : formatInr(finance.remainingBudgetInr)}
                </p>
                <p className="mt-0.5 text-[11px] font-mono tabular-nums text-[#4B5650]">
                  {finance.budgetUtilizationPct}% utilized
                </p>
              </div>
            </div>

            {/* Per-Traveller Equal Average Row */}
            <div className="mt-4 pt-3.5 border-t border-[#DFD9CE] flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 text-xs">
              <div>
                <span className="font-medium text-[#17211C]">
                  Actual Expenditure / Traveller (Equal Average):
                </span>
                <p className="text-[11px] text-[#4B5650]">
                  Total actual spent divided equally across {trip.travellers}{' '}
                  {trip.travellers === 1 ? 'traveller' : 'travellers'} — not an individual payment
                  record.
                </p>
              </div>
              <span className="font-mono tabular-nums text-base font-semibold text-[#17211C] shrink-0">
                {formatInr(finance.actualPerTravellerAvgInr)}
              </span>
            </div>

            {/* Over-budget warning banner */}
            {finance.isOverBudget && (
              <div
                role="status"
                className="mt-3.5 p-3 bg-[#FDF4F2] border border-[#E5B9B0] rounded-md flex items-start gap-2 text-xs text-[#7D2617]"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="leading-relaxed">
                  <strong>Over estimated budget by {formatInr(finance.overBudgetInr)}.</strong>{' '}
                  Recorded actual expenses ({formatInr(finance.actualTotalInr)}) exceed your
                  estimated trip total ({formatInr(finance.estimatedTotalInr)}).
                </p>
              </div>
            )}

            {/* Compact 4-Category Estimated Breakdown */}
            <dl className="mt-3.5 pt-3.5 border-t border-[#DFD9CE] grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-[#4B5650]">Est. Accommodation</dt>
                <dd className="font-mono tabular-nums text-[#17211C]">
                  {formatInr(costBreakdown.accommodationInr)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#4B5650]">Est. Transportation</dt>
                <dd className="font-mono tabular-nums text-[#17211C]">
                  {formatInr(costBreakdown.transportationInr)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#4B5650]">Est. Activities</dt>
                <dd className="font-mono tabular-nums text-[#17211C]">
                  {formatInr(costBreakdown.activitiesInr)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#4B5650]">Est. Food</dt>
                <dd className="font-mono tabular-nums text-[#17211C]">
                  {formatInr(costBreakdown.foodInr)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Day-by-Day Schedule */}
      <div className="mt-10 space-y-10">
        {daysList.map((dayNumber) => {
          const dayItems = trip.items.filter((i) => i.dayNumber === dayNumber);
          const daySubtotal = recalculateItineraryTotal(dayItems);
          const dayActualSubtotal = dayItems.reduce((sum, item) => {
            const exp = findExpenseForItem(trip.expenses, item.id);
            return sum + (exp ? exp.amountInr : 0);
          }, 0);
          const dayDate = computeDateForTripDay(trip.startDate, dayNumber);

          return (
            <section key={dayNumber} className="border-t border-[#DFD9CE] pt-7">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <h2 className="font-editorial text-2xl sm:text-3xl text-[#17211C]">
                    Day {dayNumber}{' '}
                    <span className="text-sm font-mono font-normal text-[#4B5650] tabular-nums ml-2">
                      {dayDate}
                    </span>
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-5">
                  <span className="text-xs font-mono tabular-nums text-[#4B5650]">
                    Est. <strong className="text-[#17211C]">{formatInr(daySubtotal)}</strong>
                    {dayActualSubtotal > 0 && (
                      <>
                        {' '}
                        · Actual{' '}
                        <strong className="text-[#1B4B3A]">{formatInr(dayActualSubtotal)}</strong>
                      </>
                    )}
                  </span>
                  {!isArchived && (
                    <button
                      type="button"
                      onClick={() => setAddingToDay(addingToDay === dayNumber ? null : dayNumber)}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1B4B3A] hover:text-[#13382B] whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Add Activity</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Add Activity Inline Picker */}
              {addingToDay === dayNumber && !isArchived && (
                <div className="mt-4 p-5 bg-[#EFECE4] border border-[#D8D1C4] rounded-lg">
                  <div className="flex items-center justify-between gap-2 mb-3.5">
                    <p className="text-sm font-semibold text-[#17211C]">
                      {discoveredPois.length > 0
                        ? `Add a discovered landmark near ${trip.destinationName} to Day ${dayNumber}`
                        : `Add an activity or planning window in ${trip.destinationName} to Day ${dayNumber}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => setAddingToDay(null)}
                      aria-label="Close activity picker"
                      className="text-[#4B5650] hover:text-[#17211C]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                    {discoveredPois.map((poi) => (
                      <button
                        key={poi.id}
                        type="button"
                        onClick={() => handleAddPoiToDay(dayNumber, poi)}
                        className="text-left p-3.5 bg-white border border-[#DFD9CE] hover:border-[#1B4B3A] rounded-md transition-colors flex items-start justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-[#17211C]">{poi.name}</p>
                          <p className="text-xs text-[#4B5650] mt-0.5">
                            {formatPoiCategoryLabel(poi.category)} · ~{poi.distanceKm.toFixed(1)} km
                            · {poi.estimatedDurationHours} hrs
                            {poi.dataOrigin === 'verified_osm' ? ' · Verified OSM' : ''}
                          </p>
                        </div>
                        <span className="font-mono tabular-nums text-xs font-medium text-[#17211C] whitespace-nowrap shrink-0">
                          {formatInr(poi.estimatedPerPersonInr * trip.travellers)}
                        </span>
                      </button>
                    ))}

                    {matchingSeedExperiences.map((exp) => {
                      const dest = getDestinationById(exp.destinationId);
                      return (
                        <button
                          key={exp.id}
                          type="button"
                          onClick={() => handleAddSeedExperienceToDay(dayNumber, exp.id)}
                          className="text-left p-3.5 bg-white border border-[#DFD9CE] hover:border-[#1B4B3A] rounded-md transition-colors flex items-start justify-between gap-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-[#17211C]">{exp.name}</p>
                            <p className="text-xs text-[#4B5650] mt-0.5">
                              {dest?.name} · {exp.durationHours} hrs
                              {exp.difficulty ? ` · ${exp.difficulty}` : ''}
                            </p>
                          </div>
                          <span className="font-mono tabular-nums text-xs font-medium text-[#17211C] whitespace-nowrap shrink-0">
                            {formatInr(exp.estimatedPerPersonInr * trip.travellers)}
                          </span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => handleAddPlanningBlockToDay(dayNumber, 'self_paced')}
                      className="text-left p-3.5 bg-white border border-[#DFD9CE] hover:border-[#1B4B3A] rounded-md transition-colors flex items-start justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#17211C]">
                          Self-Paced Local Exploration in {trip.destinationName}
                        </p>
                        <p className="text-xs text-[#4B5650] mt-0.5">
                          Estimated Guidance · 2.5 hrs · Markets, cafes, or rest
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-medium text-[#1B4B3A] whitespace-nowrap shrink-0">
                        {formatInr(0)}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleAddPlanningBlockToDay(dayNumber, 'guided_local')}
                      className="text-left p-3.5 bg-white border border-[#DFD9CE] hover:border-[#1B4B3A] rounded-md transition-colors flex items-start justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#17211C]">
                          Local Guided Orientation in {trip.destinationName}
                        </p>
                        <p className="text-xs text-[#4B5650] mt-0.5">
                          Estimated Guidance · 3.5 hrs · Verify guide locally
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-medium text-[#17211C] whitespace-nowrap shrink-0">
                        {formatInr(1200 * trip.travellers)}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {dayItems.length === 0 ? (
                <div className="mt-4 p-6 bg-white border border-[#DFD9CE] rounded-md text-sm text-[#4B5650]">
                  No scheduled items on Day {dayNumber}. Use “Add Activity” above to add a
                  discovered landmark or planning window.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {dayItems.map((item) => {
                    const canReplace =
                      !isArchived &&
                      (item.itemType === 'accommodation' || item.itemType === 'activity');
                    const canEnquire =
                      (item.itemType === 'accommodation' || item.itemType === 'activity') &&
                      Boolean(item.catalogId);
                    const originTag = dataOriginLabel(item);
                    const recordedExpense = findExpenseForItem(trip.expenses, item.id);
                    const variance = recordedExpense
                      ? computeItemExpenseVariance(item.estimatedCostInr, recordedExpense.amountInr)
                      : null;
                    const isEditingExpense = itemExpenseDraft?.itemId === item.id;
                    const isSavingThisExpense =
                      Boolean(recordedExpense && expenseSavingId === recordedExpense.id) ||
                      expenseSavingId === getDeterministicItemExpenseId(item.id);

                    return (
                      <div
                        key={item.id}
                        className={`bg-white border rounded-lg p-6 transition-colors ${
                          item.completed ? 'border-[#C4D6CD] bg-[#FAFBF9]' : 'border-[#DFD9CE]'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
                          <div className="flex items-start gap-3.5">
                            <button
                              type="button"
                              role="checkbox"
                              disabled={isArchived}
                              aria-checked={item.completed}
                              aria-label={`Mark ${item.title} as ${
                                item.completed ? 'incomplete' : 'completed'
                              }`}
                              onClick={() => handleToggleCompleted(item)}
                              className={`mt-1 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                item.completed
                                  ? 'bg-[#1B4B3A] border-[#1B4B3A] text-white'
                                  : 'bg-white border-[#B9B0A0] hover:border-[#1B4B3A]'
                              }`}
                            >
                              {item.completed && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                            </button>

                            <div className="space-y-1.5">
                              <p className="text-xs font-medium text-[#4B5650]">
                                {itemTypeLabel(item)} · {item.destinationName}
                                {originTag ? ` · ${originTag}` : ''}
                                {item.difficulty ? ` · Difficulty: ${item.difficulty}` : ''}
                              </p>
                              <h3
                                className={`font-editorial text-xl sm:text-2xl ${
                                  item.completed
                                    ? 'line-through text-[#6E7872]'
                                    : 'text-[#17211C]'
                                }`}
                              >
                                {item.title}
                              </h3>
                              <p className="text-xs text-[#4B5650] flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span>{item.subtitle}</span>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-[#17211C]">
                                  <Clock className="w-3.5 h-3.5 text-[#4B5650]" aria-hidden="true" />
                                  <span>Travel time: {item.estimatedTravelTimeLabel}</span>
                                </span>
                              </p>
                              <p className="text-sm leading-relaxed text-[#4B5650] max-w-2xl">
                                {item.notes}
                              </p>

                              {item.seasonNotes && (
                                <p className="text-xs text-[#4B5650]">
                                  <strong className="font-semibold text-[#17211C]">Season:</strong>{' '}
                                  {item.seasonNotes}
                                </p>
                              )}

                              {item.safetyNotes && (
                                <div className="mt-2.5 p-3.5 bg-[#FBF7F0] border border-[#E6D6BC] rounded-md flex items-start gap-2.5 text-xs text-[#6B3F10] max-w-2xl">
                                  <ShieldAlert
                                    className="w-4 h-4 shrink-0 mt-0.5"
                                    aria-hidden="true"
                                  />
                                  <p className="leading-relaxed">
                                    <strong className="font-semibold">Safety note:</strong>{' '}
                                    {item.safetyNotes}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Cost & Actions Column */}
                          <div className="flex flex-col items-start md:items-end justify-between gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-[#EFECE4] md:min-w-[230px]">
                            <div className="w-full md:text-right space-y-1">
                              <div>
                                <p className="text-[11px] text-[#4B5650]">Estimated Cost</p>
                                <p className="font-mono tabular-nums text-lg font-medium text-[#17211C]">
                                  {formatInr(item.estimatedCostInr)}
                                </p>
                                <p className="text-xs font-mono tabular-nums text-[#4B5650]">
                                  {item.quantityLabel}
                                </p>
                              </div>

                              {/* Recorded Actual Cost & Variance */}
                              {recordedExpense && variance && (
                                <div className="pt-2 mt-2 border-t border-[#EFECE4]">
                                  <p className="text-[11px] text-[#4B5650]">
                                    Actual Spent ({recordedExpense.expenseDate})
                                  </p>
                                  <p className="font-mono tabular-nums text-base font-semibold text-[#17211C]">
                                    {formatInr(recordedExpense.amountInr)}
                                  </p>
                                  <p
                                    className={`text-xs font-mono tabular-nums font-medium ${
                                      variance.status === 'over'
                                        ? 'text-[#9B2C1B]'
                                        : variance.status === 'under'
                                        ? 'text-[#1B4B3A]'
                                        : 'text-[#4B5650]'
                                    }`}
                                  >
                                    {variance.status === 'over'
                                      ? `+${formatInr(variance.differenceInr)} over est.`
                                      : variance.status === 'under'
                                      ? `-${formatInr(Math.abs(variance.differenceInr))} under est.`
                                      : 'Matched estimate'}
                                  </p>
                                  {recordedExpense.notes && (
                                    <p className="text-[11px] text-[#4B5650] mt-0.5">
                                      Note: {recordedExpense.notes}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center md:justify-end gap-2">
                              {!isArchived && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    isEditingExpense
                                      ? setItemExpenseDraft(null)
                                      : openItemExpenseEditor(item, false)
                                  }
                                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap min-h-[36px] ${
                                    recordedExpense
                                      ? 'text-[#17211C] bg-[#EFECE4] hover:bg-[#E4DFD4] border border-[#D8D1C4]'
                                      : 'text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B]'
                                  }`}
                                >
                                  <IndianRupee className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>
                                    {recordedExpense ? 'Edit Expense' : 'Record Expense'}
                                  </span>
                                </button>
                              )}

                              {canEnquire && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onRequestEnquiry({
                                      tripId: isSaved ? trip.id : undefined,
                                      itemType:
                                        item.itemType === 'accommodation'
                                          ? 'accommodation'
                                          : 'experience',
                                      catalogId: item.catalogId!,
                                      itemName: item.title,
                                      destinationName: item.destinationName,
                                      providerName:
                                        item.providerName ?? 'Estimated Planning Guidance',
                                      preferredDate: dayDate,
                                      durationUnits:
                                        item.itemType === 'accommodation'
                                          ? 1
                                          : item.durationHours ?? 3,
                                      durationLabel:
                                        item.itemType === 'accommodation'
                                          ? item.quantityLabel
                                          : `${item.durationHours ?? 3} hrs`,
                                      travellers: trip.travellers,
                                      estimatedTotalInr: item.estimatedCostInr,
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#1B4B3A] border border-[#1B4B3A] hover:bg-[#1B4B3A] hover:text-[#F8F6F1] rounded transition-colors whitespace-nowrap min-h-[36px]"
                                >
                                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Sample Enquiry</span>
                                </button>
                              )}

                              {canReplace && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setItemExpenseDraft(null);
                                    setReplacingItemId(
                                      replacingItemId === item.id ? null : item.id
                                    );
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#17211C] border border-[#D8D1C4] hover:bg-[#EFECE4] rounded transition-colors whitespace-nowrap min-h-[36px]"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Replace</span>
                                </button>
                              )}

                              {!isArchived && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.id)}
                                  aria-label={`Remove ${item.title}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#8A2F21] border border-[#E6CFCB] hover:bg-[#FDF4F2] rounded transition-colors whitespace-nowrap min-h-[36px]"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Remove</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Inline Actual Expense Form */}
                        {isEditingExpense && itemExpenseDraft && (
                          <div className="mt-5 pt-5 border-t border-[#DFD9CE] bg-[#F8F6F1] -mx-6 -mb-6 px-6 pb-6 rounded-b-lg">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <div>
                                <p className="text-sm font-semibold text-[#17211C]">
                                  {itemExpenseDraft.fromCompletionPrompt
                                    ? 'Marked completed — record what you actually spent?'
                                    : recordedExpense
                                    ? 'Edit Actual Expense'
                                    : 'Record Actual Expense'}
                                </p>
                                <p className="text-xs text-[#4B5650] mt-0.5">
                                  Estimated cost:{' '}
                                  <span className="font-mono tabular-nums font-medium text-[#17211C]">
                                    {formatInr(item.estimatedCostInr)}
                                  </span>{' '}
                                  · Enter ₹0 for zero-cost activities, or skip to record later.
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setItemExpenseDraft((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            amountText: String(item.estimatedCostInr),
                                            error: null,
                                          }
                                        : null
                                    )
                                  }
                                  className="px-2.5 py-1 text-xs font-medium text-[#1B4B3A] border border-[#C4D6CD] bg-white hover:bg-[#F1F6F3] rounded"
                                >
                                  Use est. ({formatInr(item.estimatedCostInr)})
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setItemExpenseDraft((prev) =>
                                      prev ? { ...prev, amountText: '0', error: null } : null
                                    )
                                  }
                                  className="px-2.5 py-1 text-xs font-medium text-[#4B5650] border border-[#D8D1C4] bg-white hover:bg-[#EFECE4] rounded"
                                >
                                  ₹0 (No cost)
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                              <div className="sm:col-span-3">
                                <label
                                  htmlFor={`expense-amt-${item.id}`}
                                  className="block text-xs font-medium text-[#4B5650] mb-1"
                                >
                                  Actual Amount (₹)
                                </label>
                                <input
                                  id={`expense-amt-${item.id}`}
                                  type="number"
                                  min={0}
                                  max={50000000}
                                  step={1}
                                  inputMode="numeric"
                                  placeholder="e.g. 2400"
                                  value={itemExpenseDraft.amountText}
                                  onChange={(e) =>
                                    setItemExpenseDraft((prev) =>
                                      prev
                                        ? { ...prev, amountText: e.target.value, error: null }
                                        : null
                                    )
                                  }
                                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#D8D1C4] focus:border-[#1B4B3A] focus:outline-none rounded-md"
                                />
                              </div>

                              <div className="sm:col-span-3">
                                <label
                                  htmlFor={`expense-date-${item.id}`}
                                  className="block text-xs font-medium text-[#4B5650] mb-1"
                                >
                                  Date
                                </label>
                                <input
                                  id={`expense-date-${item.id}`}
                                  type="date"
                                  value={itemExpenseDraft.expenseDate}
                                  onChange={(e) =>
                                    setItemExpenseDraft((prev) =>
                                      prev
                                        ? { ...prev, expenseDate: e.target.value, error: null }
                                        : null
                                    )
                                  }
                                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#D8D1C4] focus:border-[#1B4B3A] focus:outline-none rounded-md"
                                />
                              </div>

                              <div className="sm:col-span-6">
                                <label
                                  htmlFor={`expense-note-${item.id}`}
                                  className="block text-xs font-medium text-[#4B5650] mb-1"
                                >
                                  Optional Note
                                </label>
                                <input
                                  id={`expense-note-${item.id}`}
                                  type="text"
                                  maxLength={300}
                                  placeholder="e.g. Paid via UPI at counter, included local guide tip"
                                  value={itemExpenseDraft.notes}
                                  onChange={(e) =>
                                    setItemExpenseDraft((prev) =>
                                      prev ? { ...prev, notes: e.target.value } : null
                                    )
                                  }
                                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D1C4] focus:border-[#1B4B3A] focus:outline-none rounded-md"
                                />
                              </div>
                            </div>

                            {itemExpenseDraft.error && (
                              <p className="mt-2 text-xs font-medium text-[#9B2C1B]">
                                {itemExpenseDraft.error}
                              </p>
                            )}

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <button
                                  type="button"
                                  disabled={isSavingThisExpense}
                                  onClick={() => void handleSubmitItemExpense(item)}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-60 rounded-md min-h-[38px]"
                                >
                                  {isSavingThisExpense && (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                                  )}
                                  <span>Save Actual Expense</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingThisExpense}
                                  onClick={() => setItemExpenseDraft(null)}
                                  className="px-3 py-2 text-xs font-medium text-[#4B5650] hover:text-[#17211C]"
                                >
                                  {itemExpenseDraft.fromCompletionPrompt
                                    ? 'Skip / Record Later'
                                    : 'Cancel'}
                                </button>
                              </div>

                              {recordedExpense && (
                                <button
                                  type="button"
                                  disabled={isSavingThisExpense}
                                  onClick={() => void handleDeleteItemExpense(recordedExpense)}
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8A2F21] hover:underline"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Clear Recorded Expense</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Inline Replacement Picker */}
                        {replacingItemId === item.id && (
                          <div className="mt-5 pt-5 border-t border-[#EFECE4]">
                            <div className="flex items-center justify-between gap-2 mb-3.5">
                              <p className="text-sm font-semibold text-[#17211C]">
                                Choose a replacement{' '}
                                {item.itemType === 'accommodation' ? 'stay band' : 'activity'} (total
                                estimated cost updates automatically):
                              </p>
                              <button
                                type="button"
                                onClick={() => setReplacingItemId(null)}
                                className="text-xs font-medium text-[#4B5650] hover:text-[#17211C]"
                              >
                                Cancel
                              </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                              {replacementChoices.map((choice) => {
                                const newEstimatedCost = choice.unitCostInr * item.quantity;
                                const diff = newEstimatedCost - item.estimatedCostInr;
                                return (
                                  <button
                                    key={choice.catalogId}
                                    type="button"
                                    onClick={() => handleApplyReplacement(choice)}
                                    className="text-left p-3.5 bg-[#F8F6F1] border border-[#DFD9CE] hover:border-[#1B4B3A] rounded-md transition-colors flex items-start justify-between gap-3"
                                  >
                                    <div>
                                      <p className="text-sm font-semibold text-[#17211C]">
                                        {choice.title}
                                      </p>
                                      <p className="text-xs text-[#4B5650] mt-0.5">
                                        {choice.tierLabel} · {choice.destinationName}
                                      </p>
                                    </div>
                                    <div className="text-right font-mono tabular-nums shrink-0">
                                      <p className="text-xs font-medium text-[#17211C]">
                                        {formatInr(newEstimatedCost)}
                                      </p>
                                      <p
                                        className={`text-xs ${
                                          diff <= 0 ? 'text-[#1B4B3A]' : 'text-[#8A5016]'
                                        }`}
                                      >
                                        {diff === 0
                                          ? 'Same'
                                          : diff > 0
                                          ? `+${formatInr(diff)}`
                                          : `-${formatInr(Math.abs(diff))}`}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Additional Unplanned Expenses Section */}
      <section className="mt-14 pt-8 border-t border-[#DFD9CE]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#4B5650]">
              Outside Planned Itinerary · Parking · Shopping · Extra Meals · Miscellaneous
            </p>
            <h2 className="mt-1 font-editorial text-2xl sm:text-3xl text-[#17211C]">
              Additional Unplanned Expenses
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-mono tabular-nums text-[#4B5650]">
              Additional subtotal:{' '}
              <strong className="text-[#17211C]">{formatInr(finance.additionalActualInr)}</strong>
            </span>
            {!isArchived && (
              <button
                type="button"
                onClick={() =>
                  additionalForm && additionalForm.id === null
                    ? setAdditionalForm(null)
                    : openNewAdditionalForm()
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md transition-colors whitespace-nowrap min-h-[40px]"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add Unplanned Expense</span>
              </button>
            )}
          </div>
        </div>

        {/* Inline Add / Edit Additional Expense Form */}
        {additionalForm && !isArchived && (
          <div className="mt-5 p-6 bg-white border border-[#1B4B3A] rounded-lg">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h3 className="text-sm font-semibold text-[#17211C]">
                {additionalForm.id ? 'Edit Additional Expense' : 'Record Additional Expense'}
              </h3>
              <button
                type="button"
                onClick={() => setAdditionalForm(null)}
                aria-label="Close expense form"
                className="text-[#4B5650] hover:text-[#17211C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
              <div className="sm:col-span-5">
                <label
                  htmlFor="extra-expense-desc"
                  className="block text-xs font-medium text-[#4B5650] mb-1"
                >
                  Description
                </label>
                <input
                  id="extra-expense-desc"
                  type="text"
                  maxLength={160}
                  placeholder="e.g. Highway toll & parking, local handicrafts, cafe snacks"
                  value={additionalForm.description}
                  onChange={(e) =>
                    setAdditionalForm((prev) =>
                      prev ? { ...prev, description: e.target.value, error: null } : null
                    )
                  }
                  className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#D8D1C4] focus:border-[#1B4B3A] focus:bg-white focus:outline-none rounded-md"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="extra-expense-cat"
                  className="block text-xs font-medium text-[#4B5650] mb-1"
                >
                  Category
                </label>
                <select
                  id="extra-expense-cat"
                  value={additionalForm.category}
                  onChange={(e) =>
                    setAdditionalForm((prev) =>
                      prev
                        ? { ...prev, category: e.target.value as ExpenseCategory, error: null }
                        : null
                    )
                  }
                  className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#D8D1C4] focus:border-[#1B4B3A] focus:bg-white focus:outline-none rounded-md"
                >
                  {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="extra-expense-amt"
                  className="block text-xs font-medium text-[#4B5650] mb-1"
                >
                  Amount (₹)
                </label>
                <input
                  id="extra-expense-amt"
                  type="number"
                  min={0}
                  max={50000000}
                  step={1}
                  inputMode="numeric"
                  placeholder="e.g. 650"
                  value={additionalForm.amountText}
                  onChange={(e) =>
                    setAdditionalForm((prev) =>
                      prev ? { ...prev, amountText: e.target.value, error: null } : null
                    )
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#F8F6F1] border border-[#D8D1C4] focus:border-[#1B4B3A] focus:bg-white focus:outline-none rounded-md"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="extra-expense-date"
                  className="block text-xs font-medium text-[#4B5650] mb-1"
                >
                  Date
                </label>
                <input
                  id="extra-expense-date"
                  type="date"
                  value={additionalForm.expenseDate}
                  onChange={(e) =>
                    setAdditionalForm((prev) =>
                      prev ? { ...prev, expenseDate: e.target.value, error: null } : null
                    )
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#F8F6F1] border border-[#D8D1C4] focus:border-[#1B4B3A] focus:bg-white focus:outline-none rounded-md"
                />
              </div>

              <div className="sm:col-span-12">
                <label
                  htmlFor="extra-expense-notes"
                  className="block text-xs font-medium text-[#4B5650] mb-1"
                >
                  Optional Note
                </label>
                <input
                  id="extra-expense-notes"
                  type="text"
                  maxLength={300}
                  placeholder="Optional receipt reference or context"
                  value={additionalForm.notes}
                  onChange={(e) =>
                    setAdditionalForm((prev) =>
                      prev ? { ...prev, notes: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#D8D1C4] focus:border-[#1B4B3A] focus:bg-white focus:outline-none rounded-md"
                />
              </div>
            </div>

            {additionalForm.error && (
              <p className="mt-3 text-xs font-medium text-[#9B2C1B]">{additionalForm.error}</p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={Boolean(expenseSavingId)}
                onClick={() => void handleSubmitAdditionalExpense()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-60 rounded-md min-h-[38px]"
              >
                {expenseSavingId && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>{additionalForm.id ? 'Update Expense' : 'Save Expense'}</span>
              </button>
              <button
                type="button"
                onClick={() => setAdditionalForm(null)}
                className="px-3 py-2 text-xs font-medium text-[#4B5650] hover:text-[#17211C]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* List of Recorded Additional Expenses */}
        {additionalExpenses.length === 0 ? (
          <div className="mt-5 p-8 bg-white border border-[#DFD9CE] rounded-lg text-center">
            <Receipt
              className="w-6 h-6 mx-auto text-[#4B5650]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="mt-2.5 text-sm font-medium text-[#17211C]">
              No additional unplanned expenses recorded yet
            </p>
            <p className="mt-1 text-xs text-[#4B5650] max-w-md mx-auto">
              Use “Add Unplanned Expense” to log parking, shopping, extra meals, local transport, or
              miscellaneous spending not in your original itinerary.
            </p>
          </div>
        ) : (
          <div className="mt-5 divide-y divide-[#EFECE4] bg-white border border-[#DFD9CE] rounded-lg">
            {additionalExpenses.map((expense) => {
              const isBusy = expenseSavingId === expense.id;
              return (
                <div
                  key={expense.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[#4B5650]">
                      {formatExpenseCategoryLabel(expense.category)} ·{' '}
                      <span className="font-mono tabular-nums">{expense.expenseDate}</span>
                    </p>
                    <p className="text-base font-medium text-[#17211C]">{expense.description}</p>
                    {expense.notes && (
                      <p className="text-xs text-[#4B5650]">{expense.notes}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    <span className="font-mono tabular-nums text-base font-semibold text-[#17211C]">
                      {formatInr(expense.amountInr)}
                    </span>

                    {!isArchived && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openEditAdditionalForm(expense)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#17211C] border border-[#D8D1C4] hover:bg-[#EFECE4] rounded transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDeleteItemExpense(expense)}
                          aria-label={`Delete ${expense.description}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#8A2F21] border border-[#E6CFCB] hover:bg-[#FDF4F2] rounded transition-colors"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
