import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  CloudUpload,
  Compass,
  Info,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { TRAVEL_INTENT_META, UNCONFIRMED_ENQUIRY_NOTICE } from '../data/sampleCatalogue';
import { computeTripFinancialSummary, formatTripDateRange } from '../engine/expenseEngine';
import { computeCompletionProgress, formatInr } from '../engine/itineraryEngine';
import { AuthUserProfile, BookingRequest, TripRecord } from '../types/roamplan';

interface MyTripsDashboardViewProps {
  user: AuthUserProfile | null;
  authLoading: boolean;
  authBusy: boolean;
  tripsLoading: boolean;
  tripsError: string | null;
  trips: TripRecord[];
  bookingRequests: BookingRequest[];
  unmigratedLocalTrips: TripRecord[];
  migrationDismissed: boolean;
  isMigrating: boolean;
  migrationNotice: string | null;
  deletingTripId: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onRetryFetch: () => void;
  onMigrateLocalTrips: () => void;
  onDismissMigration: () => void;
  onOpenTrip: (trip: TripRecord) => void;
  onDeleteTrip: (tripId: string) => void;
  onStartPlanning: () => void;
}

function ProfileAvatar({ user }: { user: AuthUserProfile }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (user.displayName || user.email || 'R')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  if (user.photoURL && !imgFailed) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-11 h-11 rounded-full object-cover border border-[#D8D1C4] shrink-0"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="w-11 h-11 rounded-full bg-[#EFECE4] border border-[#D8D1C4] text-[#1B4B3A] text-sm font-semibold inline-flex items-center justify-center shrink-0"
    >
      {initials || 'R'}
    </span>
  );
}

export function MyTripsDashboardView({
  user,
  authLoading,
  authBusy,
  tripsLoading,
  tripsError,
  trips,
  bookingRequests,
  unmigratedLocalTrips,
  migrationDismissed,
  isMigrating,
  migrationNotice,
  deletingTripId,
  onSignIn,
  onSignOut,
  onRetryFetch,
  onMigrateLocalTrips,
  onDismissMigration,
  onOpenTrip,
  onDeleteTrip,
  onStartPlanning,
}: MyTripsDashboardViewProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trips' | 'enquiries'>('trips');

  if (authLoading) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-20">
        <div className="p-12 bg-white border border-[#DFD9CE] rounded-lg text-center">
          <Loader2
            className="w-6 h-6 mx-auto text-[#1B4B3A] animate-spin"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-[#4B5650]">Checking your Google account session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-20">
        <div className="pb-6 border-b border-[#DFD9CE]">
          <p className="text-xs font-medium text-[#4B5650]">
            Cloud Firestore · Private User Storage · Google Authentication
          </p>
          <h1 className="mt-2 font-editorial text-3xl sm:text-4xl text-[#17211C]">
            My Saved Trips
          </h1>
        </div>

        <div className="mt-8 p-8 sm:p-10 bg-white border border-[#DFD9CE] rounded-lg">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-md bg-[#EFECE4] text-[#1B4B3A] flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="space-y-3">
              <h2 className="font-editorial text-2xl sm:text-3xl text-[#17211C]">
                Sign in with Google to access your cloud itineraries
              </h2>
              <p className="text-sm leading-relaxed text-[#4B5650] max-w-xl">
                Private India-wide itineraries, actual expense logs, and sample booking enquiries
                are stored securely under your verified Google account in Cloud Firestore, protected
                by owner-only Firestore Security Rules and synced across every device you sign in
                from.
              </p>

              {unmigratedLocalTrips.length > 0 && (
                <div className="mt-4 p-4 bg-[#FBF7F0] border border-[#E6D6BC] rounded-md text-xs text-[#6B3F10]">
                  <strong>
                    {unmigratedLocalTrips.length}{' '}
                    {unmigratedLocalTrips.length === 1 ? 'trip' : 'trips'} found in this browser’s
                    local storage.
                  </strong>{' '}
                  Sign in with Google to migrate your existing local itineraries to Cloud Firestore
                  without creating duplicates.
                </div>
              )}

              <div className="pt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={onSignIn}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md transition-colors min-h-[44px]"
                >
                  {authBusy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  <span>{authBusy ? 'Signing in…' : 'Sign in with Google'}</span>
                </button>
                <button
                  type="button"
                  onClick={onStartPlanning}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#17211C] border border-[#D8D1C4] hover:bg-[#EFECE4] rounded-md transition-colors min-h-[44px]"
                >
                  <span>Explore Trip Planner</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
      {/* Header + Authenticated User Profile Summary */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#DFD9CE]">
        <div className="flex items-center gap-4">
          <ProfileAvatar user={user} />
          <div>
            <p className="text-xs font-medium text-[#4B5650]">
              Cloud Firestore · Private to {user.displayName} ({user.email})
            </p>
            <h1 className="mt-1.5 font-editorial text-3xl sm:text-4xl text-[#17211C]">
              My Saved Trips
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#EFECE4] rounded-md">
            <button
              type="button"
              onClick={() => setActiveTab('trips')}
              className={`px-3.5 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                activeTab === 'trips'
                  ? 'bg-white text-[#17211C] shadow-xs'
                  : 'text-[#4B5650] hover:text-[#17211C]'
              }`}
            >
              Saved Trips ({trips.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('enquiries')}
              className={`px-3.5 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                activeTab === 'enquiries'
                  ? 'bg-white text-[#17211C] shadow-xs'
                  : 'text-[#4B5650] hover:text-[#17211C]'
              }`}
            >
              Sample Enquiries ({bookingRequests.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onStartPlanning}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md transition-colors whitespace-nowrap min-h-[42px]"
          >
            <span>New Trip</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={authBusy}
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#4B5650] border border-[#D8D1C4] hover:text-[#17211C] hover:bg-[#EFECE4] rounded-md transition-colors whitespace-nowrap min-h-[42px]"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Post-Migration Success Notice */}
      {migrationNotice && (
        <div className="mt-6 p-4 bg-[#F1F6F3] border border-[#CFE0D8] rounded-lg flex items-start gap-2.5 text-sm text-[#174233]">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">{migrationNotice}</p>
        </div>
      )}

      {/* LocalStorage → Cloud Firestore Deduplicated Migration Banner */}
      {!migrationDismissed && unmigratedLocalTrips.length > 0 && (
        <div className="mt-6 p-5 bg-[#FBF7F0] border border-[#E6D6BC] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CloudUpload
              className="w-5 h-5 text-[#7A440E] shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-xs text-[#6B3F10] space-y-1">
              <p className="font-semibold text-sm text-[#17211C]">
                Migrate {unmigratedLocalTrips.length} local browser{' '}
                {unmigratedLocalTrips.length === 1 ? 'trip' : 'trips'} to Cloud Firestore
              </p>
              <p className="leading-relaxed">
                You have existing itineraries saved locally on this device. Migrate them to your
                Google account so they sync across devices without duplicating already-saved trips.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={isMigrating}
              onClick={onMigrateLocalTrips}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md transition-colors whitespace-nowrap min-h-[40px]"
            >
              {isMigrating && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              <span>{isMigrating ? 'Migrating…' : 'Migrate to Cloud'}</span>
            </button>
            <button
              type="button"
              disabled={isMigrating}
              onClick={onDismissMigration}
              className="px-3 py-2 text-xs font-medium text-[#4B5650] hover:text-[#17211C] whitespace-nowrap"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Firestore Fetch Error State */}
      {tripsError && (
        <div
          role="alert"
          className="mt-6 p-4 bg-[#FDF4F2] border border-[#E5B9B0] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-[#7D2617]"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">{tripsError}</p>
          </div>
          <button
            type="button"
            onClick={onRetryFetch}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#7D2617] border border-[#D7A297] hover:bg-white rounded transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading State */}
      {tripsLoading ? (
        <div className="mt-8 p-12 bg-white border border-[#DFD9CE] rounded-lg text-center">
          <Loader2
            className="w-6 h-6 mx-auto text-[#1B4B3A] animate-spin"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-[#4B5650]">
            Loading your itineraries and expense logs from Cloud Firestore…
          </p>
        </div>
      ) : (
        <>
          {/* Saved Trips Tab */}
          {activeTab === 'trips' && (
            <section className="mt-8">
              {trips.length === 0 ? (
                <div className="p-10 bg-white border border-[#DFD9CE] rounded-lg text-center">
                  <Compass
                    className="w-7 h-7 mx-auto text-[#4B5650]"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <h2 className="mt-3 font-editorial text-2xl sm:text-3xl text-[#17211C]">
                    No cloud trips saved yet
                  </h2>
                  <p className="mt-2 text-sm text-[#4B5650] max-w-md mx-auto leading-relaxed">
                    Plan an itinerary for any destination in India, compare Budget, Experience, and
                    Luxury tiers, and save your favourite directly to Cloud Firestore to track
                    actual expenses against your estimated baseline.
                  </p>
                  <button
                    type="button"
                    onClick={onStartPlanning}
                    className="mt-6 px-5 py-2.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md transition-colors min-h-[44px]"
                  >
                    Open Trip Planner
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {trips.map((trip) => {
                    const progress = computeCompletionProgress(trip.items);
                    const finance = computeTripFinancialSummary(trip);
                    const dateRange = formatTripDateRange(trip.startDate, trip.days);
                    const isConfirming = confirmDeleteId === trip.id;
                    const isDeleting = deletingTripId === trip.id;

                    const styleLabel =
                      trip.style === 'budget_explorer'
                        ? 'Budget Explorer'
                        : trip.style === 'experience_seeker'
                        ? 'Experience Seeker'
                        : 'Luxury Traveller';

                    return (
                      <article
                        key={trip.id}
                        className="bg-white border border-[#DFD9CE] rounded-lg p-6 flex flex-col justify-between"
                      >
                        <div>
                          {/* 1. Destination & itinerary type */}
                          <p className="text-xs font-medium text-[#4B5650]">
                            {trip.destinationName} · {TRAVEL_INTENT_META[trip.intent].label} ·{' '}
                            {styleLabel}
                          </p>
                          <h2 className="mt-1.5 font-editorial text-2xl text-[#17211C]">
                            {trip.title}
                          </h2>

                          {/* 2 & 3. Travel dates, duration, route & travellers */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#4B5650]">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-[#4B5650]" aria-hidden="true" />
                              <span className="font-mono tabular-nums text-[#17211C]">
                                {dateRange}
                              </span>
                              <span>
                                ({trip.days} {trip.days === 1 ? 'day' : 'days'})
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-[#4B5650]" aria-hidden="true" />
                              <span className="text-[#17211C]">
                                {trip.travellers} {trip.travellers === 1 ? 'traveller' : 'travellers'}
                              </span>
                            </span>
                          </div>

                          {trip.stopNames.length > 1 && (
                            <p className="mt-1.5 text-xs text-[#4B5650]">
                              Route: {trip.stopNames.join(' → ')}
                            </p>
                          )}

                          {/* 4, 5, 6, 7. Financial Summary anchored to Estimated Total Trip Cost */}
                          <div className="mt-5 pt-4 border-t border-[#EFECE4] grid grid-cols-2 gap-x-5 gap-y-4">
                            <div>
                              <p className="text-xs text-[#4B5650]">Estimated Trip Cost</p>
                              <p className="mt-0.5 font-mono tabular-nums text-lg font-medium text-[#17211C]">
                                {formatInr(finance.estimatedTotalInr)}
                              </p>
                              <p className="text-[11px] font-mono tabular-nums text-[#4B5650]">
                                {formatInr(finance.estimatedPerTravellerInr)} / traveller est.
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-[#4B5650]">Actual Spent</p>
                              <p className="mt-0.5 font-mono tabular-nums text-lg font-medium text-[#17211C]">
                                {formatInr(finance.actualTotalInr)}
                              </p>
                              <p className="text-[11px] text-[#4B5650]">
                                {finance.recordedExpenseCount === 0
                                  ? 'No expenses recorded yet'
                                  : `${finance.recordedExpenseCount} ${
                                      finance.recordedExpenseCount === 1 ? 'entry' : 'entries'
                                    } recorded`}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-[#4B5650]">
                                {finance.isOverBudget ? 'Over Estimated Budget' : 'Remaining Estimate'}
                              </p>
                              <p
                                className={`mt-0.5 font-mono tabular-nums text-base font-medium ${
                                  finance.isOverBudget ? 'text-[#9B2C1B]' : 'text-[#1B4B3A]'
                                }`}
                              >
                                {finance.isOverBudget
                                  ? `-${formatInr(finance.overBudgetInr)}`
                                  : formatInr(finance.remainingBudgetInr)}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs text-[#4B5650]">Avg. Actual / Traveller</p>
                              <p className="mt-0.5 font-mono tabular-nums text-base font-medium text-[#17211C]">
                                {formatInr(finance.actualPerTravellerAvgInr)}
                              </p>
                              <p className="text-[11px] text-[#4B5650]">
                                Equal average (not individual payments)
                              </p>
                            </div>
                          </div>

                          {/* Over-Budget Warning Callout (non-hue-only text + icon) */}
                          {finance.isOverBudget && (
                            <div
                              role="status"
                              className="mt-4 p-3 bg-[#FDF4F2] border border-[#E5B9B0] rounded-md flex items-start gap-2 text-xs text-[#7D2617]"
                            >
                              <AlertTriangle
                                className="w-4 h-4 shrink-0 mt-0.5"
                                aria-hidden="true"
                              />
                              <p className="leading-relaxed">
                                <strong>Over estimated budget by {formatInr(finance.overBudgetInr)}</strong>{' '}
                                ({finance.budgetUtilizationPct}% of estimated trip cost used).
                              </p>
                            </div>
                          )}

                          {/* 8 & 9. Separate Progress Bars: Budget Utilization vs Itinerary Completion */}
                          <div className="mt-5 pt-4 border-t border-[#EFECE4] space-y-3.5">
                            {/* Budget Utilization Progress Bar */}
                            <div>
                              <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                                <span className="font-medium text-[#17211C]">
                                  Budget Utilization
                                </span>
                                <span
                                  className={`font-mono tabular-nums ${
                                    finance.isOverBudget
                                      ? 'font-semibold text-[#9B2C1B]'
                                      : 'text-[#4B5650]'
                                  }`}
                                >
                                  {formatInr(finance.actualTotalInr)} /{' '}
                                  {formatInr(finance.estimatedTotalInr)} (
                                  {finance.budgetUtilizationPct}%)
                                </span>
                              </div>
                              <div
                                className="w-full h-1.5 bg-[#EFECE4] rounded-full overflow-hidden"
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

                            {/* Itinerary Completion Progress Bar (strictly independent of expenses) */}
                            <div>
                              <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                                <span className="font-medium text-[#17211C]">
                                  Itinerary Completion
                                </span>
                                <span className="font-mono tabular-nums text-[#4B5650]">
                                  {progress.completedCount}/{progress.totalCount} items (
                                  {progress.percentage}%)
                                </span>
                              </div>
                              <div
                                className="w-full h-1.5 bg-[#EFECE4] rounded-full overflow-hidden"
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
                            </div>
                          </div>
                        </div>

                        {/* 10. View/Edit and Delete Actions */}
                        <div className="mt-6 pt-4 border-t border-[#EFECE4] flex items-center justify-between gap-3">
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => onOpenTrip(trip)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-60 rounded-md transition-colors min-h-[42px]"
                          >
                            <span>View &amp; Edit Trip</span>
                            <ArrowRight className="w-4 h-4" aria-hidden="true" />
                          </button>

                          {isDeleting ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-[#8A2F21]">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              <span>Deleting…</span>
                            </span>
                          ) : isConfirming ? (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-[#8A2F21]">Delete trip?</span>
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteTrip(trip.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2.5 py-1.5 font-semibold text-white bg-[#9B2C1B] rounded"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2.5 py-1.5 text-[#4B5650] hover:text-[#17211C]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(trip.id)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8A2F21] hover:underline"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Sample Booking Enquiries Tab */}
          {activeTab === 'enquiries' && (
            <section className="mt-8 space-y-5">
              <div className="p-4 bg-[#FBF7F0] border border-[#E6D6BC] rounded-lg flex items-start gap-2.5 text-xs text-[#6B3F10]">
                <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="leading-relaxed">
                  <strong>Booking Transparency:</strong> {UNCONFIRMED_ENQUIRY_NOTICE} All saved
                  entries remain <span className="font-mono">requested</span> (unconfirmed). No
                  payments are collected.
                </p>
              </div>

              {bookingRequests.length === 0 ? (
                <div className="p-10 bg-white border border-[#DFD9CE] rounded-lg text-center">
                  <h2 className="font-editorial text-2xl text-[#17211C]">
                    No sample enquiries submitted yet
                  </h2>
                  <p className="mt-2 text-sm text-[#4B5650] max-w-md mx-auto">
                    Open any destination or itinerary item and select “Sample Enquiry” to store an
                    unconfirmed request in Cloud Firestore.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {bookingRequests.map((req) => (
                    <article
                      key={req.id}
                      className="bg-white border border-[#DFD9CE] rounded-lg p-6"
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-[#4B5650]">
                            {req.itemType === 'accommodation' ? 'Stay Enquiry' : 'Activity Enquiry'}{' '}
                            · {req.destinationName} · <span className="font-mono">{req.id}</span>
                          </p>
                          <h3 className="font-editorial text-xl text-[#17211C]">{req.itemName}</h3>
                          <p className="text-xs text-[#4B5650]">
                            Reference: {req.providerName} · Preferred date:{' '}
                            <span className="font-mono tabular-nums">{req.preferredDate}</span> ·{' '}
                            {req.travellers} {req.travellers === 1 ? 'traveller' : 'travellers'}
                          </p>
                          {req.specialNotes && (
                            <p className="text-xs text-[#4B5650]">Notes: {req.specialNotes}</p>
                          )}
                          <p className="pt-2 text-xs font-medium text-[#7A440E]">
                            Status: Requested (Unconfirmed) — {req.confirmationNotice}
                          </p>
                        </div>

                        <div className="md:text-right shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-[#EFECE4]">
                          <p className="font-mono tabular-nums text-lg font-medium text-[#17211C]">
                            {formatInr(req.estimatedTotalInr)}
                          </p>
                          <p className="text-xs text-[#4B5650]">
                            Illustrative estimate · {req.durationLabel}
                          </p>
                          <p className="mt-1 text-xs font-mono tabular-nums text-[#4B5650]">
                            Submitted {req.createdAt.slice(0, 10)}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
