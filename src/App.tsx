import { Component, ErrorInfo, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { AlertCircle, Info, X } from 'lucide-react';
import { AboutDisclosureView } from './components/AboutDisclosureView';
import { BookingEnquiryModal } from './components/BookingEnquiryModal';
import { DestinationDetailView } from './components/DestinationDetailView';
import { ExploreView } from './components/ExploreView';
import { ItineraryComparisonView } from './components/ItineraryComparisonView';
import { ItineraryEditorView } from './components/ItineraryEditorView';
import { MyTripsDashboardView } from './components/MyTripsDashboardView';
import { Navbar } from './components/Navbar';
import { TripPlannerWizard } from './components/TripPlannerWizard';
import { SAMPLE_PROVENANCE } from './data/sampleCatalogue';
import { removeExpenseFromList, upsertExpenseInList } from './engine/expenseEngine';
import { generateThreeItineraryOptions } from './engine/itineraryEngine';
import {
  classifyGeographicRegion,
  getCuratedSeedDestinations,
  resolveDestinationByName,
  slugifyDestinationId,
} from './services/destinationService';
import {
  auth,
  formatReadableAuthError,
  formatReadableFirestoreError,
  signInWithGoogle,
  signOutFirebase,
} from './services/firebase';
import {
  createUserBookingRequestInFirestore,
  deleteTripExpenseFromFirestore,
  deleteUserTripFromFirestore,
  fetchUserBookingRequests,
  fetchUserTrips,
  filterUnmigratedLocalTrips,
  migrateLocalTripsToFirestore,
  saveUserTripToFirestore,
  upsertTripExpenseInFirestore,
  upsertUserProfile,
} from './services/firestoreService';
import { discoverNearbyForDestination } from './services/geospatialDiscoveryService';
import { listSavedTrips, removeLocalTripsByIds } from './services/storage';
import {
  AppView,
  AuthUserProfile,
  BookingEnquiryDraft,
  BookingRequest,
  DestinationDiscoveryResult,
  GeneratedItineraryOption,
  NearbyStopCandidate,
  ResolvedDestination,
  TravelIntent,
  TripExpense,
  TripPlanInput,
  TripRecord,
} from './types/roamplan';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected interface error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RoamPlan ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8F6F1] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#DFD9CE] rounded-lg p-6 text-center">
            <h1 className="font-editorial text-2xl text-[#17211C]">Something went wrong</h1>
            <p className="mt-2 text-sm text-[#4B5650]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 px-5 py-2.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] rounded-md"
            >
              Reload RoamPlan
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function defaultStartDate(): string {
  return new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
}

function toAuthUserProfile(fbUser: User): AuthUserProfile {
  return {
    uid: fbUser.uid,
    displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'RoamPlan Traveller',
    email: fbUser.email || '',
    photoURL: fbUser.photoURL || '',
    emailVerified: fbUser.emailVerified,
  };
}

const DEFAULT_SEED_DESTINATION: ResolvedDestination = getCuratedSeedDestinations()[0];

function RoamPlanApp() {
  const [activeView, setActiveView] = useState<AppView>('explore');
  const [selectedDestination, setSelectedDestination] = useState<ResolvedDestination>(
    DEFAULT_SEED_DESTINATION
  );
  const [activeDiscovery, setActiveDiscovery] = useState<DestinationDiscoveryResult | null>(null);

  const [planInput, setPlanInput] = useState<TripPlanInput>({
    destinationId: DEFAULT_SEED_DESTINATION.id,
    destination: DEFAULT_SEED_DESTINATION,
    startDate: defaultStartDate(),
    days: 4,
    travellers: 2,
    budgetInr: 36000,
    intent: 'travel',
    interests: ['Heritage & Architecture', 'Local Food & Cafes', 'Nature & Forests'],
  });

  // Firebase Auth state
  const [authUser, setAuthUser] = useState<AuthUserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Itinerary planning & editor state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatingStatus, setGeneratingStatus] = useState<string | null>(null);
  const [generatedOptions, setGeneratedOptions] = useState<GeneratedItineraryOption[]>([]);
  const [editingTrip, setEditingTrip] = useState<TripRecord | null>(null);
  const [editingIsSaved, setEditingIsSaved] = useState<boolean>(false);
  const [editorReturnView, setEditorReturnView] = useState<AppView>('results');
  const [isSavingTrip, setIsSavingTrip] = useState<boolean>(false);

  // Cloud Firestore state
  const [savedTrips, setSavedTrips] = useState<TripRecord[]>([]);
  const [bookingRequests, setBookingRequests] = useState<BookingRequest[]>([]);
  const [tripsLoading, setTripsLoading] = useState<boolean>(false);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);

  // LocalStorage fallback & migration state
  const [unmigratedLocalTrips, setUnmigratedLocalTrips] = useState<TripRecord[]>(() =>
    listSavedTrips()
  );
  const [migrationDismissed, setMigrationDismissed] = useState<boolean>(false);
  const [isMigrating, setIsMigrating] = useState<boolean>(false);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);

  // Global modal & alert state
  const [enquiryDraft, setEnquiryDraft] = useState<BookingEnquiryDraft | null>(null);
  const [appError, setAppError] = useState<string | null>(null);

  // Serialize Firestore updates to prevent concurrent batch races on rapid clicks
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveTripRef = useRef<TripRecord | null>(null);
  const editingIsSavedRef = useRef<boolean>(false);
  editingIsSavedRef.current = editingIsSaved;

  const persistTripToCloud = useCallback(
    async (uid: string, tripToSave: TripRecord, isUpdate: boolean): Promise<TripRecord> => {
      setIsSavingTrip(true);
      setAppError(null);
      try {
        const persisted = await saveUserTripToFirestore(
          uid,
          {
            localSourceId: tripToSave.localSourceId,
            title: tripToSave.title.trim() || `${tripToSave.destinationName} Trip`,
            destinationId: tripToSave.destinationId,
            destinationName: tripToSave.destinationName,
            stopNames: tripToSave.stopNames,
            startDate: tripToSave.startDate,
            days: tripToSave.days,
            travellers: tripToSave.travellers,
            budgetInr: tripToSave.budgetInr,
            intent: tripToSave.intent,
            style: tripToSave.style,
            interests: tripToSave.interests,
            items: tripToSave.items,
            expenses: tripToSave.expenses ?? [],
            budgetExplanation: tripToSave.budgetExplanation,
            status: tripToSave.status === 'archived' ? 'archived' : 'planned',
            provenance: tripToSave.provenance || SAMPLE_PROVENANCE,
          },
          isUpdate ? tripToSave.id : undefined
        );

        const mergeExpenses = (existing: TripRecord | null | undefined) => {
          if (!isUpdate || !existing) return persisted.expenses ?? [];
          const survivingItemIds = new Set(persisted.items.map((i) => i.id));
          return (existing.expenses ?? persisted.expenses ?? []).filter(
            (exp) =>
              exp.kind !== 'itinerary_item' ||
              !exp.itineraryItemId ||
              survivingItemIds.has(exp.itineraryItemId)
          );
        };

        setEditingTrip((current) => {
          if (!isUpdate) return persisted;
          if (!current || current.id !== tripToSave.id) return current;
          return { ...persisted, expenses: mergeExpenses(current) };
        });
        setEditingIsSaved(true);
        setSavedTrips((prev) => {
          const prevTrip = prev.find((t) => t.id === persisted.id);
          const merged = { ...persisted, expenses: mergeExpenses(prevTrip) };
          const filtered = prev.filter((t) => t.id !== persisted.id);
          return [merged, ...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
        return persisted;
      } catch (error) {
        setAppError(formatReadableFirestoreError(error));
        throw error;
      } finally {
        setIsSavingTrip(false);
      }
    },
    []
  );

  const loadUserCloudData = useCallback(
    async (fbUser: User, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setTripsLoading(true);
      }
      setTripsError(null);
      try {
        await upsertUserProfile(fbUser);
        const [cloudTrips, cloudEnquiries] = await Promise.all([
          fetchUserTrips(fbUser.uid),
          fetchUserBookingRequests(fbUser.uid),
        ]);

        setSavedTrips(cloudTrips);
        setBookingRequests(cloudEnquiries);
        setUnmigratedLocalTrips(filterUnmigratedLocalTrips(listSavedTrips(), cloudTrips));

        // Keep an open saved trip synchronized with authoritative Firestore data
        if (editingIsSavedRef.current) {
          setEditingTrip((current) => {
            if (!current) return current;
            const latest = cloudTrips.find((t) => t.id === current.id);
            return latest ?? current;
          });
        }

        if (pendingSaveTripRef.current) {
          const pending = pendingSaveTripRef.current;
          pendingSaveTripRef.current = null;
          await persistTripToCloud(fbUser.uid, pending, false);
        }
      } catch (error) {
        setTripsError(formatReadableFirestoreError(error));
      } finally {
        if (!options?.silent) {
          setTripsLoading(false);
        }
      }
    },
    [persistTripToCloud]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        const profile = toAuthUserProfile(fbUser);
        setAuthUser(profile);
        setAuthLoading(false);
        setMigrationDismissed(false);
        void loadUserCloudData(fbUser);
      } else {
        setAuthUser(null);
        setAuthLoading(false);
        setSavedTrips([]);
        setBookingRequests([]);
        setTripsError(null);
        setTripsLoading(false);
        setMigrationNotice(null);
        setUnmigratedLocalTrips(listSavedTrips());
        // Clear any open private cloud trip on sign-out to prevent cross-account data exposure
        if (editingIsSavedRef.current) {
          setEditingTrip(null);
          setEditingIsSaved(false);
        }
      }
    });

    return () => unsubscribe();
  }, [loadUserCloudData]);

  const navigateTo = (view: AppView) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Whenever returning to My Trips while signed in, wait for queued writes and
    // silently re-sync from Firestore so dashboard totals always reflect cloud truth.
    if (view === 'my-trips' && auth.currentUser) {
      const currentUser = auth.currentUser;
      void syncQueueRef.current
        .catch(() => {
          // Prior write error already surfaced
        })
        .then(() => {
          if (auth.currentUser?.uid === currentUser.uid) {
            void loadUserCloudData(currentUser, { silent: true });
          }
        });
    }
  };

  const handleSignIn = async () => {
    setAppError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      pendingSaveTripRef.current = null;
      const parsed = formatReadableAuthError(error);
      if (parsed.cancelled) {
        setAuthNotice(parsed.message);
      } else {
        setAppError(parsed.message);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAppError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      await signOutFirebase();
      setAuthNotice('Signed out cleanly. Your saved itineraries remain safely in Cloud Firestore.');
    } catch (error) {
      setAppError(formatReadableAuthError(error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRetryFetch = () => {
    if (auth.currentUser) {
      void loadUserCloudData(auth.currentUser);
    }
  };

  const handleSelectDestination = (dest: ResolvedDestination) => {
    setSelectedDestination(dest);
    if (activeDiscovery && activeDiscovery.destination.id !== dest.id) {
      setActiveDiscovery(null);
    }
    navigateTo('destination');
  };

  const handleExploreNearbyStop = (
    stop: NearbyStopCandidate,
    parent: ResolvedDestination
  ) => {
    const stopState = stop.state || parent.state;
    const region = classifyGeographicRegion(
      stopState,
      stop.coordinates.lat,
      stop.coordinates.lng
    );
    const resolvedStop: ResolvedDestination = {
      id: slugifyDestinationId(stop.name, stopState),
      name: stop.name,
      state: stopState,
      country: 'India',
      coordinates: stop.coordinates,
      locationType: stop.locationType,
      geographicRegion: region,
      displayLabel: `${stop.name}, ${stopState}`,
      summary: `Nearby destination approximately ${stop.distanceKm.toFixed(0)} km from ${parent.name} in ${stopState} (${region}).`,
      source: stop.dataOrigin === 'curated_seed' ? 'curated_seed' : 'osm_nominatim',
      curatedSeedId:
        getCuratedSeedDestinations().find((s) => s.id === stop.id)?.id ?? undefined,
    };
    handleSelectDestination(resolvedStop);
  };

  const handleStartPlanning = (
    presetDestination?: ResolvedDestination,
    presetIntent?: TravelIntent,
    cachedDiscovery?: DestinationDiscoveryResult | null
  ) => {
    if (cachedDiscovery) {
      setActiveDiscovery(cachedDiscovery);
    }
    setPlanInput((prev) => ({
      ...prev,
      destinationId: presetDestination?.id ?? prev.destinationId,
      destination: presetDestination ?? prev.destination,
      intent: presetIntent ?? prev.intent,
    }));
    navigateTo('plan');
  };

  const handleGenerateOptions = async (input: TripPlanInput) => {
    setAppError(null);
    setPlanInput(input);
    setIsGenerating(true);

    const targetDest =
      input.destination ??
      getCuratedSeedDestinations().find((s) => s.id === input.destinationId) ??
      null;

    if (!targetDest) {
      setIsGenerating(false);
      setGeneratingStatus(null);
      setAppError('Please search and select a destination in India before generating itineraries.');
      return;
    }

    setGeneratingStatus(`Discovering OpenStreetMap landmarks around ${targetDest.name}…`);

    try {
      const discovery =
        activeDiscovery && activeDiscovery.destination.id === targetDest.id
          ? activeDiscovery
          : await discoverNearbyForDestination(targetDest);

      setActiveDiscovery(discovery);
      setGeneratingStatus(`Curating Budget, Experience & Luxury plans for ${targetDest.name}…`);

      const options = generateThreeItineraryOptions(
        {
          ...input,
          destinationId: targetDest.id,
          destination: targetDest,
        },
        discovery
      );

      setGeneratedOptions(options);
      setSelectedDestination(targetDest);
      setIsGenerating(false);
      setGeneratingStatus(null);
      navigateTo('results');
    } catch (err) {
      setIsGenerating(false);
      setGeneratingStatus(null);
      setAppError(
        err instanceof Error ? err.message : 'Unable to generate itineraries for those inputs.'
      );
    }
  };

  const handleSelectOptionForEdit = (option: GeneratedItineraryOption) => {
    const now = new Date().toISOString();
    const draftTrip: TripRecord = {
      id: `draft-${option.style}-${Date.now().toString(36)}`,
      title: `${option.destinationName} — ${option.styleLabel} Plan`,
      destinationId: option.destinationId,
      destinationName: option.destinationName,
      stopNames: option.stopNames,
      startDate: planInput.startDate,
      days: option.days,
      travellers: option.travellers,
      budgetInr: option.budgetInr,
      intent: option.intent,
      style: option.style,
      interests: planInput.interests,
      items: option.items,
      expenses: [],
      costBreakdown: option.costBreakdown,
      estimatedTotalInr: option.estimatedTotalInr,
      withinBudget: option.withinBudget,
      budgetExplanation: option.budgetExplanation,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      provenance: SAMPLE_PROVENANCE,
    };
    setEditingTrip(draftTrip);
    setEditingIsSaved(false);
    setEditorReturnView('results');
    navigateTo('editor');
  };

  const handleOpenSavedTrip = (trip: TripRecord) => {
    setEditingTrip(trip);
    setEditingIsSaved(true);
    setEditorReturnView('my-trips');

    // Clear mismatched discovery and silently warm OSM POIs for this saved Indian destination
    if (!activeDiscovery || activeDiscovery.destination.id !== trip.destinationId) {
      setActiveDiscovery(null);
      const seedMatch = getCuratedSeedDestinations().find((s) => s.id === trip.destinationId);
      const hydrate = async () => {
        const dest = seedMatch ?? (await resolveDestinationByName(trip.destinationName));
        if (!dest) return;
        const normalizedDest: ResolvedDestination = {
          ...dest,
          id: trip.destinationId,
        };
        const discovered = await discoverNearbyForDestination(normalizedDest);
        setActiveDiscovery((current) =>
          current && current.destination.id === trip.destinationId ? current : discovered
        );
      };
      void hydrate().catch(() => {
        // Silent best-effort enrichment for editor pickers; editor still works cleanly offline
      });
    }

    navigateTo('editor');
  };

  const handleSaveTrip = async (tripToSave: TripRecord) => {
    if (!authUser) {
      pendingSaveTripRef.current = tripToSave;
      await handleSignIn();
      return;
    }

    await persistTripToCloud(authUser.uid, tripToSave, editingIsSaved);
  };

  const handleSignInForSave = () => {
    if (editingTrip) {
      pendingSaveTripRef.current = editingTrip;
    }
    void handleSignIn();
  };

  const handleChangeEditingTrip = (
    updated: TripRecord,
    options?: { syncToCloud?: boolean }
  ) => {
    setEditingTrip(updated);
    if (editingIsSaved) {
      setSavedTrips((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }
    if (options?.syncToCloud && editingIsSaved && authUser) {
      const uid = authUser.uid;
      syncQueueRef.current = syncQueueRef.current
        .then(async () => {
          await persistTripToCloud(uid, updated, true);
        })
        .catch(() => {
          // Error already surfaced via appError in persistTripToCloud
        });
    }
  };

  const handleSaveExpense = async (expense: TripExpense): Promise<void> => {
    if (!editingTrip) return;
    const tripId = editingTrip.id;
    const isCloudSynced = editingIsSavedRef.current && Boolean(authUser);

    setAppError(null);
    const applyExpenseToState = (savedExpense: TripExpense) => {
      setEditingTrip((current) =>
        current && current.id === tripId
          ? { ...current, expenses: upsertExpenseInList(current.expenses, savedExpense) }
          : current
      );
      if (editingIsSavedRef.current) {
        setSavedTrips((prev) =>
          prev.map((t) =>
            t.id === tripId ? { ...t, expenses: upsertExpenseInList(t.expenses, savedExpense) } : t
          )
        );
      }
    };

    if (isCloudSynced && authUser) {
      const uid = authUser.uid;
      setIsSavingTrip(true);
      try {
        const persisted = await new Promise<TripExpense>((resolve, reject) => {
          syncQueueRef.current = syncQueueRef.current.then(async () => {
            try {
              const saved = await upsertTripExpenseInFirestore(uid, tripId, {
                ...expense,
                tripId,
                ownerUid: uid,
              });
              resolve(saved);
            } catch (err) {
              reject(err);
            }
          });
        });
        // Only update editor & My Trips after Firestore confirms persistence
        applyExpenseToState(persisted);
      } catch (error) {
        setAppError(formatReadableFirestoreError(error));
        throw error;
      } finally {
        setIsSavingTrip(false);
      }
      return;
    }

    // Unsaved local draft (not yet stored in Firestore)
    applyExpenseToState({ ...expense, tripId });
  };

  const handleDeleteExpense = async (expenseId: string): Promise<void> => {
    if (!editingTrip) return;
    const tripId = editingTrip.id;
    const isCloudSynced = editingIsSavedRef.current && Boolean(authUser);

    setAppError(null);
    const removeExpenseFromState = () => {
      setEditingTrip((current) =>
        current && current.id === tripId
          ? { ...current, expenses: removeExpenseFromList(current.expenses, expenseId) }
          : current
      );
      if (editingIsSavedRef.current) {
        setSavedTrips((prev) =>
          prev.map((t) =>
            t.id === tripId ? { ...t, expenses: removeExpenseFromList(t.expenses, expenseId) } : t
          )
        );
      }
    };

    if (isCloudSynced && authUser) {
      const uid = authUser.uid;
      setIsSavingTrip(true);
      try {
        await new Promise<void>((resolve, reject) => {
          syncQueueRef.current = syncQueueRef.current.then(async () => {
            try {
              await deleteTripExpenseFromFirestore(uid, tripId, expenseId);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });
        // Only remove from editor & My Trips after Firestore confirms deletion
        removeExpenseFromState();
      } catch (error) {
        setAppError(formatReadableFirestoreError(error));
        throw error;
      } finally {
        setIsSavingTrip(false);
      }
      return;
    }

    // Unsaved local draft
    removeExpenseFromState();
  };

  const handleDeleteTrip = async (tripId: string) => {
    if (!authUser) return;
    setAppError(null);
    setDeletingTripId(tripId);
    try {
      await deleteUserTripFromFirestore(authUser.uid, tripId);
      setSavedTrips((prev) => prev.filter((t) => t.id !== tripId));
      if (editingTrip?.id === tripId) {
        setEditingTrip(null);
        setEditingIsSaved(false);
      }
    } catch (error) {
      setAppError(formatReadableFirestoreError(error));
    } finally {
      setDeletingTripId(null);
    }
  };

  const handleMigrateLocalTrips = async () => {
    if (!authUser) return;
    setAppError(null);
    setMigrationNotice(null);
    setIsMigrating(true);
    try {
      const localTrips = listSavedTrips();
      const { migratedIds, skippedCount } = await migrateLocalTripsToFirestore(
        authUser.uid,
        localTrips,
        savedTrips
      );

      if (migratedIds.length > 0) {
        removeLocalTripsByIds(migratedIds);
      }

      const refreshedCloudTrips = await fetchUserTrips(authUser.uid);
      setSavedTrips(refreshedCloudTrips);
      setUnmigratedLocalTrips(filterUnmigratedLocalTrips(listSavedTrips(), refreshedCloudTrips));

      if (migratedIds.length > 0) {
        setMigrationNotice(
          `Migrated ${migratedIds.length} local ${
            migratedIds.length === 1 ? 'trip' : 'trips'
          } to Cloud Firestore${
            skippedCount > 0 ? ` (${skippedCount} duplicate skipped)` : ''
          }.`
        );
      } else {
        setMigrationNotice(
          'All local trips were already present in your Cloud Firestore account — no duplicates were created.'
        );
      }
    } catch (error) {
      setAppError(formatReadableFirestoreError(error));
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSubmitEnquiry = async (
    draft: BookingEnquiryDraft,
    contactName: string,
    contactEmail: string,
    specialNotes: string
  ): Promise<BookingRequest> => {
    if (!authUser) {
      throw new Error('Please sign in with Google before submitting a sample enquiry.');
    }
    const created = await createUserBookingRequestInFirestore(
      authUser.uid,
      draft,
      contactName,
      contactEmail,
      specialNotes
    );
    setBookingRequests((prev) => [created, ...prev]);
    return created;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F6F1] text-[#17211C]">
      <Navbar
        activeView={activeView}
        savedTripCount={savedTrips.length}
        user={authUser}
        authLoading={authLoading}
        authBusy={authBusy}
        onNavigate={navigateTo}
        onSignIn={() => void handleSignIn()}
        onSignOut={() => void handleSignOut()}
      />

      {appError && (
        <div
          role="alert"
          className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4"
        >
          <div className="p-4 bg-[#FDF4F2] border border-[#E5B9B0] rounded-md flex items-center justify-between gap-3 text-sm text-[#7D2617]">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{appError}</span>
            </div>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setAppError(null)}
              className="text-[#7D2617] hover:opacity-75"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {authNotice && !appError && (
        <div
          role="status"
          className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4"
        >
          <div className="p-4 bg-[#FBF7F0] border border-[#E6D6BC] rounded-md flex items-center justify-between gap-3 text-sm text-[#6B3F10]">
            <div className="flex items-center gap-2.5">
              <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{authNotice}</span>
            </div>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setAuthNotice(null)}
              className="text-[#6B3F10] hover:opacity-75"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {activeView === 'explore' && (
          <ExploreView
            onSelectDestination={handleSelectDestination}
            onStartPlanning={(dest, intent) => handleStartPlanning(dest, intent)}
            onOpenAbout={() => navigateTo('about')}
          />
        )}

        {activeView === 'destination' && (
          <DestinationDetailView
            destination={selectedDestination}
            onBack={() => navigateTo('explore')}
            onPlanHere={(dest, discovery) => handleStartPlanning(dest, undefined, discovery)}
            onExploreNearbyStop={handleExploreNearbyStop}
            onRequestEnquiry={(draft) => setEnquiryDraft(draft)}
          />
        )}

        {activeView === 'plan' && (
          <TripPlannerWizard
            initialInput={planInput}
            isGenerating={isGenerating}
            generatingStatus={generatingStatus}
            onGenerate={(input) => void handleGenerateOptions(input)}
          />
        )}

        {activeView === 'results' && (
          <ItineraryComparisonView
            input={planInput}
            options={
              generatedOptions.length > 0
                ? generatedOptions
                : generateThreeItineraryOptions(planInput, activeDiscovery ?? undefined)
            }
            onBackToWizard={() => navigateTo('plan')}
            onSelectOption={handleSelectOptionForEdit}
          />
        )}

        {activeView === 'editor' && editingTrip && (
          <ItineraryEditorView
            trip={editingTrip}
            discovery={activeDiscovery}
            isSaved={editingIsSaved}
            user={authUser}
            authBusy={authBusy}
            isSaving={isSavingTrip}
            onBack={() => navigateTo(editorReturnView)}
            onChangeTrip={handleChangeEditingTrip}
            onSaveTrip={handleSaveTrip}
            onSaveExpense={handleSaveExpense}
            onDeleteExpense={handleDeleteExpense}
            onSignInForSave={handleSignInForSave}
            onRequestEnquiry={(draft) => setEnquiryDraft(draft)}
          />
        )}

        {activeView === 'editor' && !editingTrip && (
          <div className="max-w-lg mx-auto px-4 py-20 text-center">
            <h1 className="font-editorial text-3xl text-[#17211C]">No active itinerary selected</h1>
            <p className="mt-2.5 text-sm text-[#4B5650]">
              Generate an itinerary for any destination in India or open one of your saved cloud
              trips.
            </p>
            <button
              type="button"
              onClick={() => navigateTo('plan')}
              className="mt-5 px-5 py-2.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md min-h-[44px]"
            >
              Open Trip Planner
            </button>
          </div>
        )}

        {activeView === 'my-trips' && (
          <MyTripsDashboardView
            user={authUser}
            authLoading={authLoading}
            authBusy={authBusy}
            tripsLoading={tripsLoading}
            tripsError={tripsError}
            trips={savedTrips}
            bookingRequests={bookingRequests}
            unmigratedLocalTrips={unmigratedLocalTrips}
            migrationDismissed={migrationDismissed}
            isMigrating={isMigrating}
            migrationNotice={migrationNotice}
            deletingTripId={deletingTripId}
            onSignIn={() => void handleSignIn()}
            onSignOut={() => void handleSignOut()}
            onRetryFetch={handleRetryFetch}
            onMigrateLocalTrips={() => void handleMigrateLocalTrips()}
            onDismissMigration={() => setMigrationDismissed(true)}
            onOpenTrip={handleOpenSavedTrip}
            onDeleteTrip={(id) => void handleDeleteTrip(id)}
            onStartPlanning={() => handleStartPlanning()}
          />
        )}

        {activeView === 'about' && (
          <AboutDisclosureView onStartPlanning={() => handleStartPlanning()} />
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-[#DFD9CE] bg-[#F3F0E8]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-[#4B5650]">
          <div className="space-y-1">
            <p className="font-editorial text-lg text-[#17211C]">RoamPlan</p>
            <p>
              India-Wide Travel Itinerary Planner · OpenStreetMap geospatial discovery · Estimated
              planning costs &amp; private Cloud Firestore sync.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <button
              type="button"
              onClick={() => navigateTo('explore')}
              className="hover:text-[#17211C]"
            >
              Explore
            </button>
            <button
              type="button"
              onClick={() => navigateTo('plan')}
              className="hover:text-[#17211C]"
            >
              Plan a Trip
            </button>
            <button
              type="button"
              onClick={() => navigateTo('my-trips')}
              className="hover:text-[#17211C]"
            >
              My Trips
            </button>
            <button
              type="button"
              onClick={() => navigateTo('about')}
              className="hover:text-[#17211C]"
            >
              Data &amp; Transparency
            </button>
          </div>
        </div>
      </footer>

      {/* Global Sample Booking Enquiry Modal */}
      {enquiryDraft && (
        <BookingEnquiryModal
          draft={enquiryDraft}
          user={authUser}
          authBusy={authBusy}
          onSignIn={() => void handleSignIn()}
          onClose={() => setEnquiryDraft(null)}
          onSubmitEnquiry={handleSubmitEnquiry}
          onViewEnquiries={() => navigateTo('my-trips')}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <RoamPlanApp />
    </AppErrorBoundary>
  );
}
