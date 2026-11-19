import {
  ACCOMMODATIONS,
  DAILY_FOOD_ESTIMATE_PER_PERSON_INR,
  DESTINATIONS,
  EXPERIENCES,
  INTER_STOP_TRANSFER_PER_PERSON_INR,
  LOCAL_TRANSPORT_PER_DAY_PER_PERSON_INR,
  SAMPLE_PROVENANCE,
  TRAVEL_INTENT_META,
  formatTravelDuration,
  getDestinationById,
  getEstimatedRoadMinutes,
} from '../data/sampleCatalogue';
import {
  formatLocationTypeLabel,
  getCuratedSeedDestinations,
} from '../services/destinationService';
import {
  calculateHaversineKm,
  estimateRoadMinutesFromCoordinates,
  formatPoiCategoryLabel,
} from '../services/geospatialDiscoveryService';
import {
  BudgetStyle,
  CostBreakdown,
  DestinationDiscoveryResult,
  DestinationLocationType,
  DiscoveredPoi,
  Experience,
  GeneratedItineraryOption,
  IndianGeographicRegion,
  ItineraryItem,
  NearbyStopCandidate,
  PlanValidationErrors,
  PriceTier,
  ResolvedDestination,
  TravelIntent,
  TripPlanInput,
} from '../types/roamplan';

const STYLE_CONFIG: Record<
  BudgetStyle,
  {
    label: string;
    tier: PriceTier;
    summary: string;
    maxExperiencesPerDay: number;
  }
> = {
  budget_explorer: {
    label: 'Budget',
    tier: 'budget',
    summary:
      'Economical stay category estimates, shared local transport, regional everyday meals, and accessible sights.',
    maxExperiencesPerDay: 2,
  },
  experience_seeker: {
    label: 'Experience',
    tier: 'midrange',
    summary:
      'Mid-range boutique stay guidance, dedicated local cabs, sit-down regional dining, and curated local landmarks.',
    maxExperiencesPerDay: 2,
  },
  luxury_traveller: {
    label: 'Luxury',
    tier: 'luxury',
    summary:
      'Premium retreat stay bands, private chauffeur SUV mobility, curated dining allowances, and unhurried pacing.',
    maxExperiencesPerDay: 2,
  },
};

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Validates pan-India trip planning inputs. Accepts ANY dynamically resolved Indian destination
 * (no longer restricted to the 7 curated Himachal seed destinations).
 */
export function validateTripPlanInput(input: TripPlanInput): PlanValidationErrors {
  const errors: PlanValidationErrors = {};

  const hasResolvedDest = Boolean(
    input.destination &&
      input.destination.name.trim().length > 0 &&
      Number.isFinite(input.destination.coordinates.lat) &&
      Number.isFinite(input.destination.coordinates.lng)
  );
  const hasSeedDest = Boolean(input.destinationId && getDestinationById(input.destinationId));

  if (!hasResolvedDest && !hasSeedDest) {
    errors.destinationId =
      'Please search and select any destination across India before generating itineraries.';
  }

  if (!input.startDate) {
    errors.startDate = 'Please select a start date for your trip.';
  } else {
    const parsed = new Date(input.startDate + 'T00:00:00');
    if (Number.isNaN(parsed.getTime())) {
      errors.startDate = 'Start date must be a valid calendar date.';
    }
  }

  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 14) {
    errors.days = 'Travel duration must be a whole number between 1 and 14 days.';
  }

  if (!Number.isInteger(input.travellers) || input.travellers < 1 || input.travellers > 12) {
    errors.travellers = 'Number of travellers must be between 1 and 12.';
  }

  if (!Number.isFinite(input.budgetInr) || input.budgetInr < 1500 || input.budgetInr > 5000000) {
    errors.budgetInr = 'Total budget must be between ₹1,500 and ₹50,00,000.';
  }

  if (!input.intent || !TRAVEL_INTENT_META[input.intent]) {
    errors.intent = 'Please choose one of the five travel preferences.';
  }

  return errors;
}

export function calculateCostBreakdown(items: ItineraryItem[]): CostBreakdown {
  let accommodationInr = 0;
  let transportationInr = 0;
  let activitiesInr = 0;
  let foodInr = 0;

  for (const item of items) {
    const cost = Math.max(0, Math.round(item.estimatedCostInr));
    switch (item.costCategory) {
      case 'accommodation':
        accommodationInr += cost;
        break;
      case 'transportation':
        transportationInr += cost;
        break;
      case 'food':
        foodInr += cost;
        break;
      case 'activities':
      default:
        activitiesInr += cost;
        break;
    }
  }

  return {
    accommodationInr,
    transportationInr,
    activitiesInr,
    foodInr,
    totalInr: accommodationInr + transportationInr + activitiesInr + foodInr,
  };
}

export function recalculateItineraryTotal(items: ItineraryItem[]): number {
  return calculateCostBreakdown(items).totalInr;
}

export function computeCompletionProgress(items: ItineraryItem[]): {
  completedCount: number;
  totalCount: number;
  percentage: number;
} {
  const totalCount = items.length;
  if (totalCount === 0) {
    return { completedCount: 0, totalCount: 0, percentage: 0 };
  }
  const completedCount = items.filter((item) => item.completed).length;
  return {
    completedCount,
    totalCount,
    percentage: Math.round((completedCount / totalCount) * 100),
  };
}

interface ContextualStayEstimate {
  catalogId: string;
  title: string;
  propertyType: string;
  estimatedNightlyInr: number;
  maxGuestsPerRoom: number;
  summary: string;
  seasonNotes: string;
  providerName: string;
  provenance: string;
  dataOrigin: 'curated_seed' | 'estimated_guidance';
}

function getRegionalPriceMultiplier(
  region: IndianGeographicRegion,
  locationType: DestinationLocationType
): number {
  let multiplier = 1.0;
  if (locationType === 'city' || locationType === 'beach' || region === 'Indian Islands') {
    multiplier = 1.15;
  } else if (locationType === 'village' || region === 'East & Northeast India') {
    multiplier = 0.92;
  } else if (locationType === 'heritage' || locationType === 'hill_station') {
    multiplier = 1.05;
  }
  return multiplier;
}

/**
 * Generates contextual accommodation guidance for ANY Indian destination without fabricating
 * real hotel listings, availability, reviews, or confirmed rates.
 */
export function buildContextualStayEstimate(
  stop: {
    id: string;
    name: string;
    state: string;
    locationType: DestinationLocationType;
    geographicRegion: IndianGeographicRegion;
    curatedSeedId?: string;
  },
  tier: PriceTier
): ContextualStayEstimate {
  const mult = getRegionalPriceMultiplier(stop.geographicRegion, stop.locationType);
  const baseRates: Record<PriceTier, number> = {
    budget: Math.round((1500 * mult) / 50) * 50,
    midrange: Math.round((4400 * mult) / 100) * 100,
    luxury: Math.round((11500 * mult) / 100) * 100,
  };

  const settingDescriptor =
    stop.locationType === 'beach'
      ? 'coastal'
      : stop.locationType === 'hill_station' || stop.locationType === 'valley'
      ? 'hillside'
      : stop.locationType === 'heritage'
      ? 'heritage-quarter'
      : stop.locationType === 'city'
      ? 'central'
      : 'local';

  if (tier === 'budget') {
    return {
      catalogId: `stay-est-budget-${stop.id}`.slice(0, 64),
      title: `Estimated Budget Stay in ${stop.name}`,
      propertyType: `Family Homestay / Backpacker Guesthouse (${settingDescriptor})`,
      estimatedNightlyInr: baseRates.budget,
      maxGuestsPerRoom: 2,
      summary: `Illustrative nightly budget band for clean, locally run ${settingDescriptor} homestays or private guesthouse rooms in ${stop.name}, ${stop.state}. Specific verified properties will be enabled in a future marketplace release.`,
      seasonNotes:
        'Peak holiday & weekend tariffs vary across Indian states; verify property reviews and availability independently before booking.',
      providerName: 'Estimated Stay Category (Unverified — Live Listings Planned)',
      provenance: SAMPLE_PROVENANCE,
      dataOrigin: 'estimated_guidance',
    };
  }

  if (tier === 'midrange') {
    return {
      catalogId: `stay-est-mid-${stop.id}`.slice(0, 64),
      title: `Estimated Boutique Stay in ${stop.name}`,
      propertyType: `Boutique ${settingDescriptor} stay / Mid-range lodge`,
      estimatedNightlyInr: baseRates.midrange,
      maxGuestsPerRoom: 2,
      summary: `Illustrative nightly allowance for a well-located boutique guesthouse, heritage stay, or mid-range lodge in ${stop.name}, ${stop.state} with on-site breakfast and regional character.`,
      seasonNotes:
        'Advance enquiries recommended during peak regional travel windows; RoamPlan does not display live inventory or confirmed rates.',
      providerName: 'Estimated Stay Category (Unverified — Live Listings Planned)',
      provenance: SAMPLE_PROVENANCE,
      dataOrigin: 'estimated_guidance',
    };
  }

  return {
    catalogId: `stay-est-lux-${stop.id}`.slice(0, 64),
    title: `Estimated Luxury Retreat in ${stop.name}`,
    propertyType: `Sanctuary Resort / Heritage Luxury Property (${settingDescriptor})`,
    estimatedNightlyInr: baseRates.luxury,
    maxGuestsPerRoom: 2,
    summary: `Illustrative nightly band for a full-service sanctuary resort, restored heritage property, or design-led retreat in ${stop.name}, ${stop.state}.`,
    seasonNotes:
      'Rates are illustrative planning estimates only; verified partner hotels and live availability are planned for a future release.',
    providerName: 'Estimated Stay Category (Unverified — Live Listings Planned)',
    provenance: SAMPLE_PROVENANCE,
    dataOrigin: 'estimated_guidance',
  };
}

interface RouteStop {
  id: string;
  name: string;
  state: string;
  locationType: DestinationLocationType;
  geographicRegion: IndianGeographicRegion;
  coordinates: { lat: number; lng: number };
  estimatedRoadMinutesFromPrimary: number;
  curatedSeedId?: string;
}

function resolvePrimaryDestination(
  input: TripPlanInput,
  discovery?: DestinationDiscoveryResult
): ResolvedDestination {
  if (discovery?.destination) return discovery.destination;
  if (input.destination) return input.destination;

  const seed = getCuratedSeedDestinations().find((s) => s.id === input.destinationId);
  if (seed) return seed;

  return getCuratedSeedDestinations()[0];
}

/**
 * Selects geographically feasible stops for multi-location journeys when duration permits.
 * Uses verified OSM nearby towns/villages (12–55 km) when available.
 */
function buildDynamicRouteStops(
  primary: ResolvedDestination,
  nearbyStops: NearbyStopCandidate[],
  days: number,
  intent: TravelIntent
): RouteStop[] {
  const baseStop: RouteStop = {
    id: primary.id,
    name: primary.name,
    state: primary.state,
    locationType: primary.locationType,
    geographicRegion: primary.geographicRegion,
    coordinates: primary.coordinates,
    estimatedRoadMinutesFromPrimary: 0,
    curatedSeedId: primary.curatedSeedId,
  };

  if (days < 3) return [baseStop];
  if (intent === 'rest' && days < 6) return [baseStop];

  const maxStops =
    intent === 'travel'
      ? days >= 5
        ? 3
        : 2
      : days >= 6
      ? 3
      : days >= 4
      ? 2
      : 1;

  if (maxStops === 1 || nearbyStops.length === 0) return [baseStop];

  const stops: RouteStop[] = [baseStop];
  // Prefer nearby stops between 14 km and 55 km for sensible intermediary bases
  const feasible = [...nearbyStops].sort((a, b) => a.distanceKm - b.distanceKm);

  for (const candidate of feasible) {
    if (stops.some((s) => s.name.toLowerCase() === candidate.name.toLowerCase())) continue;
    stops.push({
      id: candidate.id,
      name: candidate.name,
      state: candidate.state,
      locationType: candidate.locationType,
      geographicRegion: primary.geographicRegion,
      coordinates: candidate.coordinates,
      estimatedRoadMinutesFromPrimary: candidate.estimatedRoadMinutes,
      curatedSeedId: getDestinationById(candidate.id)?.id,
    });
    if (stops.length >= maxStops) break;
  }

  return stops;
}

function scoreDiscoveredPoi(
  poi: DiscoveredPoi,
  intent: TravelIntent,
  interests: string[],
  tier: PriceTier,
  usedCategories: Map<string, number>
): number {
  let score = 0;

  // Prefer verified OpenStreetMap POIs and curated examples over generic fallbacks
  if (poi.dataOrigin === 'verified_osm') score += 18;
  if (poi.dataOrigin === 'curated_seed') score += 14;

  // Strong intent alignment
  if (poi.suitableIntents.includes(intent)) score += 35;

  if (intent === 'trek' && (poi.category === 'adventure_location' || poi.category === 'lake_waterfall' || poi.category === 'natural_landmark')) {
    score += 38;
  }
  if (intent === 'adventure' && (poi.category === 'adventure_location' || poi.category === 'natural_landmark')) {
    score += 40;
  }
  if (intent === 'rest' && (poi.category === 'viewpoint' || poi.category === 'natural_landmark' || poi.category === 'lake_waterfall')) {
    score += 34;
  }
  if (intent === 'enjoy' && (poi.category === 'cultural_heritage' || poi.category === 'local_area' || poi.category === 'tourist_attraction' || poi.category === 'viewpoint')) {
    score += 34;
  }
  if (intent === 'travel' && (poi.category === 'viewpoint' || poi.category === 'tourist_attraction' || poi.category === 'cultural_heritage' || poi.category === 'natural_landmark')) {
    score += 26;
  }

  // Interest matching
  for (const interest of interests) {
    if (poi.interestTags.includes(interest)) {
      score += 16;
    }
  }

  // Distance feasibility (favor closer sights within 15 km)
  if (poi.distanceKm <= 6) score += 12;
  else if (poi.distanceKm <= 14) score += 6;
  else score -= 4;

  // Budget tier sensibility
  if (tier === 'budget' && poi.estimatedPerPersonInr > 1800) score -= 18;
  if (tier === 'luxury' && poi.estimatedPerPersonInr >= 1000) score += 8;

  // Diversity penalty: prevent repeating the same POI category endlessly so itineraries feel curated
  const categoryCount = usedCategories.get(poi.category) ?? 0;
  score -= categoryCount * 22;

  return score;
}

function getTierAdjustedPoiCost(poi: DiscoveredPoi, tier: PriceTier): number {
  if (poi.dataOrigin === 'curated_seed') {
    return poi.estimatedPerPersonInr;
  }
  // Verified OSM attractions have modest entry/guide planning bands scaled transparently by tier
  if (tier === 'budget') return Math.round(poi.estimatedPerPersonInr * 0.85);
  if (tier === 'luxury') return Math.round(Math.max(450, poi.estimatedPerPersonInr * 1.9));
  return Math.round(Math.max(200, poi.estimatedPerPersonInr * 1.25));
}

function buildPartialGuidanceActivity(
  tempTripId: string,
  style: BudgetStyle,
  day: number,
  stop: RouteStop,
  intent: TravelIntent,
  order: number
): ItineraryItem {
  const intentTitle: Record<TravelIntent, string> = {
    rest: `Unhurried Morning & Local Pace in ${stop.name}`,
    enjoy: `Self-Paced Local Markets, Food & Walk in ${stop.name}`,
    travel: `Regional Exploration & Scenic Detour around ${stop.name}`,
    trek: `Local Nature Trail & Acclimatization Window in ${stop.name}`,
    adventure: `Local Outdoor Activity & Operator Check in ${stop.name}`,
  };

  return {
    id: `${style}-d${day}-guidance`,
    tripId: tempTripId,
    dayNumber: day,
    order,
    itemType: 'activity',
    costCategory: 'activities',
    catalogId: `est-guidance-${stop.id}-d${day}`.slice(0, 64),
    destinationId: stop.id,
    destinationName: stop.name,
    title: intentTitle[intent],
    subtitle: `Estimated planning block · ${stop.name}, ${stop.state}`,
    notes:
      'OpenStreetMap returned limited mapped attractions for this slot. Rather than inventing places, RoamPlan reserves an unhurried window to ask local hosts for current trails, viewpoints, and neighbourhood cafés.',
    estimatedTravelTimeLabel: 'Local walk / verify locally',
    unitCostInr: 0,
    quantity: 1,
    quantityLabel: 'Open local slot · ₹0',
    estimatedCostInr: 0,
    completed: false,
    durationHours: 2.5,
    seasonNotes: 'Verify local seasonal weather and road access before heading out.',
    safetyNotes:
      intent === 'trek' || intent === 'adventure'
        ? 'Always confirm trail conditions, permits, and licensed local guides in person.'
        : undefined,
    providerName: 'Estimated Planning Guidance (Not a Verified Listing)',
    provenance: 'Estimated planning placeholder due to sparse OpenStreetMap POI coverage — no fictional attractions invented.',
    dataOrigin: 'estimated_guidance',
  };
}

function buildStyleOption(
  input: TripPlanInput,
  style: BudgetStyle,
  discovery?: DestinationDiscoveryResult
): GeneratedItineraryOption {
  const config = STYLE_CONFIG[style];
  const primary = resolvePrimaryDestination(input, discovery);
  const discoveredPois = discovery?.pois ?? [];
  const nearbyStops = discovery?.nearbyStops ?? [];

  // If discovery wasn't passed synchronously for a curated seed (e.g. direct legacy engine call),
  // build seed POI & nearby stop pools cleanly without failing
  const effectivePois: DiscoveredPoi[] =
    discoveredPois.length > 0
      ? discoveredPois
      : primary.curatedSeedId
      ? EXPERIENCES.filter(
          (e) => e.destinationId === primary.curatedSeedId && e.category !== 'transfer' && e.published
        ).map((e) => ({
          id: e.id,
          name: e.name,
          category:
            e.category === 'trek' || e.category === 'adventure'
              ? 'adventure_location'
              : e.category === 'food_culture'
              ? 'cultural_heritage'
              : 'tourist_attraction',
          experienceCategory: e.category as Exclude<Experience['category'], 'transfer'>,
          coordinates: primary.coordinates,
          distanceKm: Math.max(1, Math.round((e.estimatedTravelMinutes / 3) * 10) / 10),
          estimatedTravelMinutes: e.estimatedTravelMinutes,
          destinationId: primary.id,
          destinationName: primary.name,
          summary: e.summary,
          osmTags: {},
          dataOrigin: 'curated_seed',
          suitableIntents: e.suitableIntents,
          interestTags: e.interestTags,
          estimatedDurationHours: e.durationHours,
          estimatedPerPersonInr: e.estimatedPerPersonInr,
          difficulty: e.difficulty,
          safetyNotes: e.safetyNotes,
          seasonNotes: e.seasonNotes,
          providerName: e.providerName,
        }))
      : [];

  const effectiveNearby: NearbyStopCandidate[] =
    nearbyStops.length > 0
      ? nearbyStops
      : primary.curatedSeedId
      ? (getDestinationById(primary.curatedSeedId)?.nearbyDestinationIds ?? [])
          .map((nid) => getCuratedSeedDestinations().find((s) => s.id === nid))
          .filter((s): s is ResolvedDestination => Boolean(s))
          .map((s) => {
            const dist = calculateHaversineKm(primary.coordinates, s.coordinates);
            return {
              id: s.id,
              name: s.name,
              state: s.state,
              coordinates: s.coordinates,
              distanceKm: dist,
              estimatedRoadMinutes: getEstimatedRoadMinutes(primary.id, s.id),
              locationType: s.locationType,
              dataOrigin: 'curated_seed' as const,
            };
          })
      : [];

  const stops = buildDynamicRouteStops(primary, effectiveNearby, input.days, input.intent);

  const items: ItineraryItem[] = [];
  const tempTripId = `preview-${style}`;
  const usedPoiIds = new Set<string>();
  const usedCategoryCounts = new Map<string, number>();

  // Assign each day strictly within 1..input.days to a route stop
  const dayStops: RouteStop[] = [];
  for (let day = 1; day <= input.days; day++) {
    const stopIndex = Math.min(
      stops.length - 1,
      Math.floor(((day - 1) * stops.length) / input.days)
    );
    dayStops.push(stops[stopIndex]);
  }

  const totalNights = input.days === 1 ? 1 : input.days - 1;
  const foodPlan = DAILY_FOOD_ESTIMATE_PER_PERSON_INR[config.tier];
  const localTransport = LOCAL_TRANSPORT_PER_DAY_PER_PERSON_INR[config.tier];

  for (let day = 1; day <= input.days; day++) {
    const stop = dayStops[day - 1];
    const prevStop = day > 1 ? dayStops[day - 2] : null;
    let order = 1;

    // 1. Transportation item (Inter-stop road transfer OR local daily transport)
    if (prevStop && prevStop.id !== stop.id) {
      const distKm = calculateHaversineKm(prevStop.coordinates, stop.coordinates);
      const roadMins =
        prevStop.curatedSeedId && stop.curatedSeedId
          ? getEstimatedRoadMinutes(prevStop.curatedSeedId, stop.curatedSeedId)
          : estimateRoadMinutesFromCoordinates(distKm, {
              geographicRegion: stop.geographicRegion,
              locationType: stop.locationType,
            });
      const unitCost = INTER_STOP_TRANSFER_PER_PERSON_INR[config.tier];
      const totalTransferCost = unitCost * input.travellers;

      items.push({
        id: `${style}-d${day}-transfer`,
        tripId: tempTripId,
        dayNumber: day,
        order: order++,
        itemType: 'transportation',
        costCategory: 'transportation',
        destinationId: stop.id,
        destinationName: stop.name,
        title: `Inter-Stop Transfer: ${prevStop.name} to ${stop.name}`,
        subtitle: `${
          config.tier === 'budget'
            ? 'Shared cab / regional bus'
            : config.tier === 'midrange'
            ? 'Private sedan transfer'
            : 'Private chauffeur SUV'
        } · ~${distKm.toFixed(0)} km (${formatTravelDuration(roadMins)})`,
        notes: `Estimated road transfer from ${prevStop.name} to ${stop.name} (${stop.state}) based on geographic distance (~${distKm.toFixed(1)} km straight-line). Verify actual highway traffic and seasonal road advisories before departure.`,
        estimatedTravelTimeLabel: `${formatTravelDuration(roadMins)} (est.)`,
        unitCostInr: unitCost,
        quantity: input.travellers,
        quantityLabel: `${input.travellers} ${
          input.travellers === 1 ? 'traveller' : 'travellers'
        } × ${formatInr(unitCost)}`,
        estimatedCostInr: totalTransferCost,
        completed: false,
        durationHours: Math.round((roadMins / 60) * 10) / 10,
        provenance: SAMPLE_PROVENANCE,
        dataOrigin: 'estimated_guidance',
      });
    } else {
      const totalLocalCost = localTransport.amountInr * input.travellers;
      items.push({
        id: `${style}-d${day}-local-transport`,
        tripId: tempTripId,
        dayNumber: day,
        order: order++,
        itemType: 'transportation',
        costCategory: 'transportation',
        destinationId: stop.id,
        destinationName: stop.name,
        title: localTransport.title,
        subtitle: `${stop.name} local mobility · ${localTransport.travelTimeLabel}`,
        notes: localTransport.notes,
        estimatedTravelTimeLabel: localTransport.travelTimeLabel,
        unitCostInr: localTransport.amountInr,
        quantity: input.travellers,
        quantityLabel: `${input.travellers} ${
          input.travellers === 1 ? 'traveller' : 'travellers'
        } × ${formatInr(localTransport.amountInr)}`,
        estimatedCostInr: totalLocalCost,
        completed: false,
        provenance: SAMPLE_PROVENANCE,
        dataOrigin: 'estimated_guidance',
      });
    }

    // 2. Contextual Accommodation Guidance for each night (Day 1..totalNights)
    if (day <= totalNights) {
      const stay = buildContextualStayEstimate(stop, config.tier);
      const rooms = Math.ceil(input.travellers / stay.maxGuestsPerRoom);
      const nightCost = stay.estimatedNightlyInr * rooms;

      items.push({
        id: `${style}-d${day}-stay`,
        tripId: tempTripId,
        dayNumber: day,
        order: order++,
        itemType: 'accommodation',
        costCategory: 'accommodation',
        catalogId: stay.catalogId,
        destinationId: stop.id,
        destinationName: stop.name,
        title: stay.title,
        subtitle: `${stay.propertyType} · Night ${day} in ${stop.name}`,
        notes: stay.summary,
        estimatedTravelTimeLabel: 'Overnight base estimate',
        unitCostInr: stay.estimatedNightlyInr,
        quantity: rooms,
        quantityLabel: `1 night × ${rooms} ${rooms === 1 ? 'room' : 'rooms'} (${formatInr(
          stay.estimatedNightlyInr
        )}/room est.)`,
        estimatedCostInr: nightCost,
        completed: false,
        seasonNotes: stay.seasonNotes,
        providerName: stay.providerName,
        provenance: stay.provenance,
        dataOrigin: stay.dataOrigin,
      });
    }

    // 3. Curated Activities & Landmarks (scored by intent, interests, diversity, and proximity)
    const desiredCount =
      input.intent === 'rest'
        ? day === input.days && input.days > 1
          ? 0
          : 1
        : input.intent === 'trek'
        ? 1
        : day === input.days && input.days > 2
        ? 1
        : Math.min(config.maxExperiencesPerDay, 2);

    // Filter unused POIs and score them dynamically for this day's curation
    const remainingPois = effectivePois.filter((p) => !usedPoiIds.has(p.id));
    let addedForDay = 0;

    for (let slot = 0; slot < desiredCount; slot++) {
      if (remainingPois.length === 0) break;

      // Re-score on each slot so category diversity updates immediately
      remainingPois.sort(
        (a, b) =>
          scoreDiscoveredPoi(b, input.intent, input.interests, config.tier, usedCategoryCounts) -
          scoreDiscoveredPoi(a, input.intent, input.interests, config.tier, usedCategoryCounts)
      );

      const chosen = remainingPois.shift();
      if (!chosen) break;

      usedPoiIds.add(chosen.id);
      usedCategoryCounts.set(chosen.category, (usedCategoryCounts.get(chosen.category) ?? 0) + 1);

      const unitCost = getTierAdjustedPoiCost(chosen, config.tier);
      const totalExpCost = unitCost * input.travellers;
      const distLabel =
        chosen.distanceKm > 0 ? `~${chosen.distanceKm.toFixed(1)} km` : 'Local';

      items.push({
        id: `${style}-d${day}-poi-${chosen.id}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
        tripId: tempTripId,
        dayNumber: day,
        order: order++,
        itemType: 'activity',
        costCategory: 'activities',
        catalogId: chosen.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
        destinationId: stop.id,
        destinationName: stop.name,
        title: chosen.name,
        subtitle: `${formatPoiCategoryLabel(chosen.category)} · ${chosen.estimatedDurationHours} hrs · ${distLabel} from ${stop.name}${
          chosen.difficulty ? ` · ${chosen.difficulty}` : ''
        }`,
        notes: chosen.summary,
        estimatedTravelTimeLabel: `${formatTravelDuration(chosen.estimatedTravelMinutes)} (est.)`,
        unitCostInr: unitCost,
        quantity: input.travellers,
        quantityLabel: `${input.travellers} ${
          input.travellers === 1 ? 'traveller' : 'travellers'
        } × ${formatInr(unitCost)} est.`,
        estimatedCostInr: totalExpCost,
        completed: false,
        durationHours: chosen.estimatedDurationHours,
        seasonNotes: chosen.seasonNotes,
        difficulty: chosen.difficulty,
        safetyNotes: chosen.safetyNotes,
        providerName: chosen.providerName,
        provenance:
          chosen.dataOrigin === 'verified_osm'
            ? 'Verified location name & coordinates from OpenStreetMap; entry/guide cost and transit time are illustrative planning estimates.'
            : SAMPLE_PROVENANCE,
        dataOrigin: chosen.dataOrigin,
      });
      addedForDay++;
    }

    // If OSM returned sparse or zero POIs for this day (and the day expects an activity),
    // insert a clearly labelled honest planning window — NEVER invent fictional places!
    if (addedForDay === 0 && desiredCount > 0) {
      items.push(buildPartialGuidanceActivity(tempTripId, style, day, stop, input.intent, order++));
    }

    // 4. Daily Food Allowance
    const totalFoodCost = foodPlan.amountInr * input.travellers;
    items.push({
      id: `${style}-d${day}-food`,
      tripId: tempTripId,
      dayNumber: day,
      order: order++,
      itemType: 'food',
      costCategory: 'food',
      destinationId: stop.id,
      destinationName: stop.name,
      title: foodPlan.title,
      subtitle: `Day ${day} dining allowance · ${stop.name}`,
      notes: foodPlan.notes,
      estimatedTravelTimeLabel: 'Local walk / On-site dining',
      unitCostInr: foodPlan.amountInr,
      quantity: input.travellers,
      quantityLabel: `${input.travellers} ${
        input.travellers === 1 ? 'traveller' : 'travellers'
      } × ${formatInr(foodPlan.amountInr)}/day`,
      estimatedCostInr: totalFoodCost,
      completed: false,
      provenance: SAMPLE_PROVENANCE,
      dataOrigin: 'estimated_guidance',
    });

    // Optional Trek / Adventure Safety Advisory on Day 1
    if (day === 1 && (input.intent === 'trek' || input.intent === 'adventure')) {
      items.push({
        id: `${style}-d1-safety-note`,
        tripId: tempTripId,
        dayNumber: 1,
        order: order++,
        itemType: 'note',
        costCategory: 'activities',
        destinationId: stop.id,
        destinationName: stop.name,
        title:
          input.intent === 'trek'
            ? 'Trail Safety, Permits & Local Guide Advisory'
            : 'Outdoor Activity & Weather Verification Note',
        subtitle: 'Safety preparation · ₹0',
        notes: `Confirm regional permits, seasonal trail or water conditions, and licensed local operators in ${stop.name}, ${stop.state} before starting outdoor activities.`,
        estimatedTravelTimeLabel: 'Pre-activity check',
        unitCostInr: 0,
        quantity: 1,
        quantityLabel: 'Advisory · ₹0',
        estimatedCostInr: 0,
        completed: false,
        safetyNotes:
          'RoamPlan provides planning structure only—never live safety guarantees. Adjust plans immediately if local weather or official advisories change.',
        provenance: SAMPLE_PROVENANCE,
        dataOrigin: 'estimated_guidance',
      });
    }
  }

  // Deterministic budget trimming of optional paid activities if exceeding target budget
  let workingItems = [...items];
  let breakdown = calculateCostBreakdown(workingItems);

  if (breakdown.totalInr > input.budgetInr) {
    const removableActivities = workingItems
      .filter((i) => i.itemType === 'activity' && i.estimatedCostInr > 0)
      .sort((a, b) => b.estimatedCostInr - a.estimatedCostInr);

    let remainingActivities = removableActivities.length;
    for (const candidate of removableActivities) {
      if (breakdown.totalInr <= input.budgetInr) break;
      if (remainingActivities <= 1 && input.intent !== 'rest') break;

      workingItems = workingItems.filter((i) => i.id !== candidate.id);
      remainingActivities--;
      breakdown = calculateCostBreakdown(workingItems);
    }
  }

  const total = breakdown.totalInr;
  const withinBudget = total <= input.budgetInr;
  const budgetDeltaInr = input.budgetInr - total;
  const perPersonEstimateInr = Math.round(total / input.travellers);

  const budgetExplanation = withinBudget
    ? `Fits within your ${formatInr(input.budgetInr)} budget with ${formatInr(
        budgetDeltaInr
      )} estimated buffer remaining.`
    : `Exceeds your ${formatInr(input.budgetInr)} budget by ${formatInr(
        Math.abs(budgetDeltaInr)
      )}. Estimated ${config.label} stay bands, transport, food, and activities for ${
        input.days
      } ${input.days === 1 ? 'day' : 'days'} and ${input.travellers} ${
        input.travellers === 1 ? 'traveller' : 'travellers'
      } total ${formatInr(total)}. Try Budget tier, fewer days, or adjust items in the editor.`;

  const intentSummaryNote =
    stops.length > 1
      ? `Multi-location ${primary.state} route (${stops.map((s) => s.name).join(' → ')}) sequenced across ${
          input.days
        } days with coordinate-estimated road transit times.`
      : input.intent === 'travel' && input.days < 3
      ? `Multi-stop journeys work best with 3+ days; for ${input.days} ${
          input.days === 1 ? 'day' : 'days'
        } we focused on ${primary.displayLabel} so transit does not crowd out exploration.`
      : `${TRAVEL_INTENT_META[input.intent].planningBehavior} Focused on ${primary.displayLabel} (${formatLocationTypeLabel(
          primary.locationType
        )} · ${primary.geographicRegion}).`;

  return {
    style,
    styleLabel: config.label,
    styleSummary: config.summary,
    destinationId: primary.id,
    destinationName: primary.displayLabel,
    destinationState: primary.state,
    destinationRegion: primary.geographicRegion,
    coordinates: primary.coordinates,
    discoveryStatus: discovery?.discoveryStatus ?? (effectivePois.length > 0 ? 'verified' : 'fallback'),
    discoveryNotice: discovery?.statusMessage,
    stopNames: stops.map((s) => s.name),
    days: input.days,
    travellers: input.travellers,
    budgetInr: input.budgetInr,
    intent: input.intent,
    items: workingItems,
    costBreakdown: breakdown,
    estimatedTotalInr: total,
    perPersonEstimateInr,
    withinBudget,
    budgetDeltaInr,
    budgetExplanation,
    intentSummaryNote,
  };
}

export function generateThreeItineraryOptions(
  input: TripPlanInput,
  discovery?: DestinationDiscoveryResult
): GeneratedItineraryOption[] {
  const styles: BudgetStyle[] = ['budget_explorer', 'experience_seeker', 'luxury_traveller'];
  return styles.map((style) => buildStyleOption(input, style, discovery));
}

export interface ReplacementOption {
  catalogId: string;
  title: string;
  subtitle: string;
  notes: string;
  unitCostInr: number;
  tierLabel: string;
  destinationId: string;
  destinationName: string;
  estimatedTravelTimeLabel: string;
  providerName?: string;
  seasonNotes?: string;
  difficulty?: Experience['difficulty'];
  safetyNotes?: string;
  durationHours?: number;
  provenance: string;
  dataOrigin?: 'verified_osm' | 'curated_seed' | 'estimated_guidance';
}

export function getReplacementCatalogOptions(
  item: ItineraryItem,
  discovery?: DestinationDiscoveryResult | null
): ReplacementOption[] {
  if (item.itemType === 'accommodation') {
    // Offer contextual stay tier swaps (Budget / Experience / Luxury) for ANY Indian destination
    const destMeta = discovery?.destination;
    const stopInfo = {
      id: item.destinationId,
      name: item.destinationName,
      state: destMeta?.state ?? 'India',
      locationType: destMeta?.locationType ?? ('town' as DestinationLocationType),
      geographicRegion: destMeta?.geographicRegion ?? ('North India (Himalayas)' as IndianGeographicRegion),
      curatedSeedId: destMeta?.curatedSeedId,
    };

    const contextualOptions: ReplacementOption[] = (['budget', 'midrange', 'luxury'] as PriceTier[])
      .map((tier) => {
        const est = buildContextualStayEstimate(stopInfo, tier);
        return {
          catalogId: est.catalogId,
          title: est.title,
          subtitle: `${est.propertyType} · ${item.destinationName}`,
          notes: est.summary,
          unitCostInr: est.estimatedNightlyInr,
          tierLabel: tier === 'budget' ? 'Budget' : tier === 'midrange' ? 'Experience' : 'Luxury',
          destinationId: item.destinationId,
          destinationName: item.destinationName,
          estimatedTravelTimeLabel: 'Overnight base estimate',
          providerName: est.providerName,
          seasonNotes: est.seasonNotes,
          provenance: est.provenance,
          dataOrigin: est.dataOrigin,
        };
      })
      .filter((opt) => opt.catalogId !== item.catalogId && opt.title !== item.title);

    // If this is also a curated Himachal seed destination, include its illustrative sample entries below
    const curatedStays = ACCOMMODATIONS.filter(
      (a) => a.destinationId === item.destinationId && a.published && a.id !== item.catalogId
    ).map((a) => ({
      catalogId: a.id,
      title: a.name,
      subtitle: `${a.propertyType} · ${item.destinationName}`,
      notes: `${a.summary} Amenities: ${a.amenities.join(', ')}.`,
      unitCostInr: a.estimatedNightlyInr,
      tierLabel: a.tier === 'budget' ? 'Budget' : a.tier === 'midrange' ? 'Experience' : 'Luxury',
      destinationId: a.destinationId,
      destinationName: item.destinationName,
      estimatedTravelTimeLabel: 'Overnight base estimate',
      providerName: a.providerName,
      seasonNotes: a.seasonNotes,
      provenance: a.provenance,
      dataOrigin: 'curated_seed' as const,
    }));

    return [...contextualOptions, ...curatedStays];
  }

  // Activity replacement: prioritize dynamically discovered OSM POIs for this destination
  const dynamicPoiOptions: ReplacementOption[] = (discovery?.pois ?? [])
    .filter((p) => p.id !== item.catalogId && p.name !== item.title)
    .map((p) => ({
      catalogId: p.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
      title: p.name,
      subtitle: `${formatPoiCategoryLabel(p.category)} · ${p.estimatedDurationHours} hrs · ~${p.distanceKm.toFixed(1)} km`,
      notes: p.summary,
      unitCostInr: p.estimatedPerPersonInr,
      tierLabel: p.dataOrigin === 'verified_osm' ? 'Verified OSM' : 'Sample',
      destinationId: item.destinationId,
      destinationName: item.destinationName,
      estimatedTravelTimeLabel: `${formatTravelDuration(p.estimatedTravelMinutes)} (est.)`,
      providerName: p.providerName,
      seasonNotes: p.seasonNotes,
      difficulty: p.difficulty,
      safetyNotes: p.safetyNotes,
      durationHours: p.estimatedDurationHours,
      provenance:
        p.dataOrigin === 'verified_osm'
          ? 'Verified OpenStreetMap location with illustrative entry/activity allowance.'
          : SAMPLE_PROVENANCE,
      dataOrigin: p.dataOrigin,
    }));

  if (dynamicPoiOptions.length > 0) {
    return dynamicPoiOptions;
  }

  // Fallback for previously saved Himachal seed trips opened without live discovery bundle
  const seedMatches = EXPERIENCES.filter(
    (e) => e.destinationId === item.destinationId && e.category !== 'transfer' && e.published && e.id !== item.catalogId
  );

  if (seedMatches.length > 0) {
    return seedMatches.map((e) => {
      const dest = getDestinationById(e.destinationId);
      return {
        catalogId: e.id,
        title: e.name,
        subtitle: `${e.durationHours} hrs · ${dest?.name ?? item.destinationName}${
          e.difficulty ? ` · ${e.difficulty}` : ''
        }`,
        notes: e.summary,
        unitCostInr: e.estimatedPerPersonInr,
        tierLabel: e.tier === 'budget' ? 'Budget' : e.tier === 'midrange' ? 'Experience' : 'Luxury',
        destinationId: e.destinationId,
        destinationName: dest?.name ?? item.destinationName,
        estimatedTravelTimeLabel: formatTravelDuration(e.estimatedTravelMinutes),
        providerName: e.providerName,
        seasonNotes: e.seasonNotes,
        difficulty: e.difficulty,
        safetyNotes: e.safetyNotes,
        durationHours: e.durationHours,
        provenance: e.provenance,
        dataOrigin: 'curated_seed' as const,
      };
    });
  }

  // Honest planning fallback when replacing an activity on a sparse-OSM destination
  return [
    {
      catalogId: `est-self-paced-${item.destinationId}`.slice(0, 64),
      title: `Self-Paced Local Walk & Rest in ${item.destinationName}`,
      subtitle: `Estimated planning block · 2 hrs`,
      notes: 'Flexible low-cost exploration window without inventing unverified attractions.',
      unitCostInr: 0,
      tierLabel: 'No-Cost Option',
      destinationId: item.destinationId,
      destinationName: item.destinationName,
      estimatedTravelTimeLabel: 'Local walk',
      providerName: 'Self-Paced Planning Guidance',
      provenance: SAMPLE_PROVENANCE,
      dataOrigin: 'estimated_guidance',
    },
    {
      catalogId: `est-guided-local-${item.destinationId}`.slice(0, 64),
      title: `Local Guided Half-Day Orientation in ${item.destinationName}`,
      subtitle: `Estimated guided allowance · 3.5 hrs`,
      notes: 'Illustrative budget placeholder for hiring a verified local heritage or nature guide on arrival.',
      unitCostInr: 1200,
      tierLabel: 'Estimated Guide',
      destinationId: item.destinationId,
      destinationName: item.destinationName,
      estimatedTravelTimeLabel: 'Local transit (est.)',
      providerName: 'Verify Local Guide on Arrival',
      provenance: SAMPLE_PROVENANCE,
      dataOrigin: 'estimated_guidance',
    },
  ];
}

export function applyItemReplacement(
  items: ItineraryItem[],
  itemId: string,
  choice: ReplacementOption
): ItineraryItem[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    const nextQuantity = item.quantity;
    const nextCost = choice.unitCostInr * nextQuantity;
    const nextQuantityLabel =
      item.itemType === 'accommodation'
        ? `1 night × ${nextQuantity} ${nextQuantity === 1 ? 'room' : 'rooms'} (${formatInr(
            choice.unitCostInr
          )}/room est.)`
        : `${nextQuantity} ${nextQuantity === 1 ? 'traveller' : 'travellers'} × ${formatInr(
            choice.unitCostInr
          )} est.`;

    return {
      ...item,
      catalogId: choice.catalogId,
      destinationId: choice.destinationId,
      destinationName: choice.destinationName,
      title: choice.title,
      subtitle:
        item.itemType === 'accommodation'
          ? `${choice.subtitle} · Night ${item.dayNumber}`
          : choice.subtitle,
      notes: choice.notes,
      estimatedTravelTimeLabel: choice.estimatedTravelTimeLabel,
      unitCostInr: choice.unitCostInr,
      quantityLabel: nextQuantityLabel,
      estimatedCostInr: nextCost,
      providerName: choice.providerName,
      seasonNotes: choice.seasonNotes,
      difficulty: choice.difficulty,
      safetyNotes: choice.safetyNotes,
      durationHours: choice.durationHours,
      provenance: choice.provenance,
      dataOrigin: choice.dataOrigin,
    };
  });
}

export function createPoiItineraryItem(
  tripId: string,
  dayNumber: number,
  travellers: number,
  poi: DiscoveredPoi,
  order: number
): ItineraryItem {
  return {
    id: `custom-${Date.now().toString(36)}-${poi.id}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
    tripId,
    dayNumber,
    order,
    itemType: 'activity',
    costCategory: 'activities',
    catalogId: poi.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
    destinationId: poi.destinationId,
    destinationName: poi.destinationName,
    title: poi.name,
    subtitle: `${formatPoiCategoryLabel(poi.category)} · ${poi.estimatedDurationHours} hrs · ~${poi.distanceKm.toFixed(1)} km`,
    notes: poi.summary,
    estimatedTravelTimeLabel: `${formatTravelDuration(poi.estimatedTravelMinutes)} (est.)`,
    unitCostInr: poi.estimatedPerPersonInr,
    quantity: travellers,
    quantityLabel: `${travellers} ${travellers === 1 ? 'traveller' : 'travellers'} × ${formatInr(
      poi.estimatedPerPersonInr
    )} est.`,
    estimatedCostInr: poi.estimatedPerPersonInr * travellers,
    completed: false,
    durationHours: poi.estimatedDurationHours,
    seasonNotes: poi.seasonNotes,
    difficulty: poi.difficulty,
    safetyNotes: poi.safetyNotes,
    providerName: poi.providerName,
    provenance:
      poi.dataOrigin === 'verified_osm'
        ? 'Verified OpenStreetMap location; entry/activity allowance is an illustrative estimate.'
        : SAMPLE_PROVENANCE,
    dataOrigin: poi.dataOrigin,
  };
}

export function createActivityItineraryItem(
  tripId: string,
  dayNumber: number,
  travellers: number,
  exp: Experience,
  order: number
): ItineraryItem {
  const dest = getDestinationById(exp.destinationId);
  return {
    id: `custom-${Date.now().toString(36)}-${exp.id}`,
    tripId,
    dayNumber,
    order,
    itemType: 'activity',
    costCategory: 'activities',
    catalogId: exp.id,
    destinationId: exp.destinationId,
    destinationName: dest?.name ?? exp.destinationId,
    title: exp.name,
    subtitle: `${exp.durationHours} hrs · ${dest?.name ?? exp.destinationId}${
      exp.difficulty ? ` · Difficulty: ${exp.difficulty}` : ''
    }`,
    notes: exp.summary,
    estimatedTravelTimeLabel: formatTravelDuration(exp.estimatedTravelMinutes),
    unitCostInr: exp.estimatedPerPersonInr,
    quantity: travellers,
    quantityLabel: `${travellers} ${travellers === 1 ? 'traveller' : 'travellers'} × ${formatInr(
      exp.estimatedPerPersonInr
    )}`,
    estimatedCostInr: exp.estimatedPerPersonInr * travellers,
    completed: false,
    durationHours: exp.durationHours,
    seasonNotes: exp.seasonNotes,
    difficulty: exp.difficulty,
    safetyNotes: exp.safetyNotes,
    providerName: exp.providerName,
    provenance: exp.provenance,
    dataOrigin: 'curated_seed',
  };
}

export { DESTINATIONS };
