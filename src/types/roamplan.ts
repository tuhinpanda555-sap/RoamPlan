export type TravelIntent = 'rest' | 'enjoy' | 'travel' | 'trek' | 'adventure';

export type BudgetStyle = 'budget_explorer' | 'experience_seeker' | 'luxury_traveller';

export type PriceTier = 'budget' | 'midrange' | 'luxury';

export type CostCategory = 'accommodation' | 'transportation' | 'activities' | 'food';

export type ExperienceCategory =
  | 'rest'
  | 'food_culture'
  | 'sightseeing'
  | 'trek'
  | 'adventure'
  | 'transfer';

export type DifficultyLevel = 'Easy' | 'Moderate' | 'Challenging';

export type BookingRequestStatus = 'requested';

export type ItineraryItemType = 'accommodation' | 'transportation' | 'activity' | 'food' | 'note';

export type AppView =
  | 'explore'
  | 'destination'
  | 'plan'
  | 'results'
  | 'editor'
  | 'my-trips'
  | 'about';

export type DestinationLocationType =
  | 'city'
  | 'town'
  | 'village'
  | 'valley'
  | 'hill_station'
  | 'beach'
  | 'heritage'
  | 'nature'
  | 'region';

export type IndianGeographicRegion =
  | 'North India (Himalayas)'
  | 'North India (Plains & Desert)'
  | 'West & Coastal India'
  | 'South India'
  | 'East & Northeast India'
  | 'Central India'
  | 'Indian Islands';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ResolvedDestination {
  id: string;
  name: string;
  state: string;
  district?: string;
  country: string;
  coordinates: Coordinates;
  locationType: DestinationLocationType;
  geographicRegion: IndianGeographicRegion;
  displayLabel: string;
  summary: string;
  source: 'osm_nominatim' | 'osm_photon' | 'curated_seed';
  curatedSeedId?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
  elevationMeters?: number;
  osmId?: string;
}

export type PoiCategory =
  | 'tourist_attraction'
  | 'natural_landmark'
  | 'viewpoint'
  | 'lake_waterfall'
  | 'cultural_heritage'
  | 'adventure_location'
  | 'local_area';

export interface DiscoveredPoi {
  id: string;
  name: string;
  category: PoiCategory;
  experienceCategory: Exclude<ExperienceCategory, 'transfer'>;
  coordinates: Coordinates;
  distanceKm: number;
  estimatedTravelMinutes: number;
  destinationId: string;
  destinationName: string;
  summary: string;
  osmTags: Record<string, string>;
  dataOrigin: 'verified_osm' | 'curated_seed' | 'estimated_guidance';
  suitableIntents: TravelIntent[];
  interestTags: string[];
  estimatedDurationHours: number;
  estimatedPerPersonInr: number;
  difficulty?: DifficultyLevel;
  safetyNotes?: string;
  seasonNotes?: string;
  providerName?: string;
}

export interface NearbyStopCandidate {
  id: string;
  name: string;
  state: string;
  coordinates: Coordinates;
  distanceKm: number;
  estimatedRoadMinutes: number;
  locationType: DestinationLocationType;
  dataOrigin: 'verified_osm' | 'curated_seed';
}

export interface DestinationDiscoveryResult {
  destination: ResolvedDestination;
  pois: DiscoveredPoi[];
  nearbyStops: NearbyStopCandidate[];
  discoveryStatus: 'verified' | 'partial' | 'fallback';
  statusMessage: string;
  fetchedAt: string;
  sourceLabel: string;
}

export interface DestinationSearchOutcome {
  status: 'ok' | 'no_results' | 'unsupported_location' | 'api_error';
  results: ResolvedDestination[];
  message?: string;
  source?: 'osm_nominatim' | 'osm_photon' | 'curated_seed' | 'cache';
}

export interface CostBreakdown {
  accommodationInr: number;
  transportationInr: number;
  activitiesInr: number;
  foodInr: number;
  totalInr: number;
}

export interface Destination {
  id: string;
  name: string;
  region: string;
  elevationMeters: number;
  summary: string;
  editorialOverview: string;
  bestSeasons: string;
  idealDaysMin: number;
  idealDaysMax: number;
  supportedIntents: TravelIntent[];
  nearbyDestinationIds: string[];
  imageUrl: string;
  imageAlt: string;
  imageCaption: string;
  travelNotes: string;
  provenance: string;
  published: boolean;
}

export interface Accommodation {
  id: string;
  destinationId: string;
  name: string;
  tier: PriceTier;
  propertyType: string;
  estimatedNightlyInr: number;
  maxGuestsPerRoom: number;
  summary: string;
  amenities: string[];
  suitableIntents: TravelIntent[];
  providerName: string;
  seasonNotes: string;
  provenance: string;
  published: boolean;
}

export interface Experience {
  id: string;
  destinationId: string;
  name: string;
  category: ExperienceCategory;
  tier: PriceTier;
  durationHours: number;
  estimatedTravelMinutes: number;
  estimatedPerPersonInr: number;
  summary: string;
  seasonNotes: string;
  difficulty?: DifficultyLevel;
  safetyNotes?: string;
  providerName?: string;
  suitableIntents: TravelIntent[];
  interestTags: string[];
  provenance: string;
  published: boolean;
}

export interface TripPlanInput {
  destinationId: string;
  destination?: ResolvedDestination;
  startDate: string;
  days: number;
  travellers: number;
  budgetInr: number;
  intent: TravelIntent;
  interests: string[];
}

export interface PlanValidationErrors {
  destinationId?: string;
  startDate?: string;
  days?: string;
  travellers?: string;
  budgetInr?: string;
  intent?: string;
}

export interface AuthUserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  emailVerified: boolean;
}

export interface ItineraryItem {
  id: string;
  tripId: string;
  ownerUid?: string;
  dayNumber: number;
  order: number;
  itemType: ItineraryItemType;
  costCategory: CostCategory;
  catalogId?: string;
  destinationId: string;
  destinationName: string;
  title: string;
  subtitle: string;
  notes: string;
  estimatedTravelTimeLabel: string;
  unitCostInr: number;
  quantity: number;
  quantityLabel: string;
  estimatedCostInr: number;
  completed: boolean;
  durationHours?: number;
  seasonNotes?: string;
  difficulty?: DifficultyLevel;
  safetyNotes?: string;
  providerName?: string;
  provenance: string;
  dataOrigin?: 'verified_osm' | 'curated_seed' | 'estimated_guidance';
}

export interface GeneratedItineraryOption {
  style: BudgetStyle;
  styleLabel: string;
  styleSummary: string;
  destinationId: string;
  destinationName: string;
  destinationState?: string;
  destinationRegion?: IndianGeographicRegion;
  coordinates?: Coordinates;
  discoveryStatus?: 'verified' | 'partial' | 'fallback';
  discoveryNotice?: string;
  stopNames: string[];
  days: number;
  travellers: number;
  budgetInr: number;
  intent: TravelIntent;
  items: ItineraryItem[];
  costBreakdown: CostBreakdown;
  estimatedTotalInr: number;
  perPersonEstimateInr: number;
  withinBudget: boolean;
  budgetDeltaInr: number;
  budgetExplanation: string;
  intentSummaryNote: string;
}

export type ExpenseKind = 'itinerary_item' | 'additional';

export type ExpenseCategory =
  | 'accommodation'
  | 'transportation'
  | 'activities'
  | 'food'
  | 'parking'
  | 'shopping'
  | 'miscellaneous';

export interface TripExpense {
  id: string;
  tripId: string;
  ownerUid?: string;
  kind: ExpenseKind;
  itineraryItemId?: string;
  description: string;
  category: ExpenseCategory;
  amountInr: number;
  expenseDate: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripFinancialSummary {
  estimatedTotalInr: number;
  actualTotalInr: number;
  itemizedActualInr: number;
  additionalActualInr: number;
  remainingBudgetInr: number;
  isOverBudget: boolean;
  overBudgetInr: number;
  budgetUtilizationPct: number;
  budgetUtilizationBarPct: number;
  estimatedPerTravellerInr: number;
  actualPerTravellerAvgInr: number;
  recordedExpenseCount: number;
  recordedItemExpenseCount: number;
  additionalExpenseCount: number;
}

export interface ItemExpenseVariance {
  estimatedCostInr: number;
  actualCostInr: number;
  differenceInr: number;
  status: 'under' | 'exact' | 'over';
}

export interface TripRecord {
  id: string;
  ownerUid?: string;
  localSourceId?: string;
  title: string;
  destinationId: string;
  destinationName: string;
  stopNames: string[];
  startDate: string;
  days: number;
  travellers: number;
  budgetInr: number;
  intent: TravelIntent;
  style: BudgetStyle;
  interests: string[];
  items: ItineraryItem[];
  expenses?: TripExpense[];
  costBreakdown: CostBreakdown;
  estimatedTotalInr: number;
  withinBudget: boolean;
  budgetExplanation: string;
  status: 'draft' | 'planned' | 'archived';
  createdAt: string;
  updatedAt: string;
  provenance: string;
}

export interface BookingRequest {
  id: string;
  ownerUid?: string;
  tripId?: string;
  itemType: 'accommodation' | 'experience';
  catalogId: string;
  itemName: string;
  destinationName: string;
  providerName: string;
  preferredDate: string;
  durationUnits: number;
  durationLabel: string;
  travellers: number;
  estimatedTotalInr: number;
  contactName: string;
  contactEmail: string;
  specialNotes: string;
  status: BookingRequestStatus;
  confirmationNotice: string;
  createdAt: string;
  updatedAt: string;
  provenance: string;
}

export interface BookingEnquiryDraft {
  tripId?: string;
  itemType: 'accommodation' | 'experience';
  catalogId: string;
  itemName: string;
  destinationName: string;
  providerName: string;
  preferredDate: string;
  durationUnits: number;
  durationLabel: string;
  travellers: number;
  estimatedTotalInr: number;
}
