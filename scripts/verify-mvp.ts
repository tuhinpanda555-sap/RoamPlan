import assert from 'node:assert/strict';
import { SAMPLE_PROVENANCE } from '../src/data/sampleCatalogue';
import {
  computeItemExpenseVariance,
  computeTripFinancialSummary,
  createAdditionalExpenseId,
  findExpenseForItem,
  formatTripDateRange,
  getDeterministicItemExpenseId,
  removeExpenseFromList,
  upsertExpenseInList,
} from '../src/engine/expenseEngine';
import {
  applyItemReplacement,
  calculateCostBreakdown,
  computeCompletionProgress,
  createPoiItineraryItem,
  generateThreeItineraryOptions,
  getReplacementCatalogOptions,
  validateTripPlanInput,
} from '../src/engine/itineraryEngine';
import {
  getCuratedSeedDestinations,
  searchIndianDestinations,
  slugifyDestinationId,
} from '../src/services/destinationService';
import { discoverNearbyForDestination } from '../src/services/geospatialDiscoveryService';
import {
  StorageLike,
  createBookingRequest,
  deleteSavedTrip,
  listBookingRequests,
  listSavedTrips,
  removeLocalTripsByIds,
  saveTrip,
} from '../src/services/storage';
import {
  DestinationDiscoveryResult,
  ResolvedDestination,
  TravelIntent,
  TripExpense,
  TripPlanInput,
  TripRecord,
} from '../src/types/roamplan';
import { filterUnmigratedLocalTrips } from '../src/utils/migration';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function assertFirestoreRuleCompatibility(
  destinationId: string,
  destinationName: string,
  stopNames: string[],
  items: TripRecord['items'],
  estimatedTotalInr: number
) {
  assert.ok(
    destinationId.length >= 1 && destinationId.length <= 64 && FIRESTORE_ID_REGEX.test(destinationId),
    `destinationId "${destinationId}" violates firestore.rules isValidId`
  );
  assert.ok(
    destinationName.length >= 1 && destinationName.length <= 100,
    `destinationName "${destinationName}" violates firestore.rules length bound`
  );
  assert.ok(
    stopNames.length >= 1 && stopNames.length <= 5,
    `stopNames length ${stopNames.length} violates firestore.rules bound (1..5)`
  );
  const breakdown = calculateCostBreakdown(items);
  assert.equal(
    breakdown.accommodationInr +
      breakdown.transportationInr +
      breakdown.activitiesInr +
      breakdown.foodInr,
    estimatedTotalInr,
    'estimatedTotalInr must equal exact sum of 4 categories per firestore.rules'
  );
  for (const item of items) {
    assert.ok(
      item.id.length >= 1 && item.id.length <= 128 && FIRESTORE_ID_REGEX.test(item.id),
      `item.id "${item.id}" violates firestore.rules`
    );
    if (item.catalogId) {
      assert.ok(
        item.catalogId.length <= 128 && FIRESTORE_ID_REGEX.test(item.catalogId),
        `item.catalogId "${item.catalogId}" violates firestore.rules`
      );
    }
    assert.ok(item.notes.length <= 1000, `item.notes exceeds 1000 chars`);
    assert.ok(item.provenance.length <= 300, `item.provenance exceeds 300 chars`);
  }
}

async function run() {
  console.log('Running RoamPlan Pan-India Discovery + Curated Engine + Firestore Compatibility Suite...\n');

  // 1. Curated seed examples remain intact (never a search restriction)
  const seeds = getCuratedSeedDestinations();
  assert.equal(seeds.length, 7, 'Expected 7 curated example Himachal destinations');
  console.log(`✓ Verified ${seeds.length} curated Himachal example seeds remain available.`);

  // 2. Input validation accepts dynamic Indian destinations and rejects invalid values
  const invalidErrors = validateTripPlanInput({
    destinationId: '',
    startDate: '',
    days: 0,
    travellers: 20,
    budgetInr: 100,
    intent: 'enjoy',
    interests: [],
  });
  assert.ok(
    invalidErrors.destinationId &&
      invalidErrors.startDate &&
      invalidErrors.days &&
      invalidErrors.travellers &&
      invalidErrors.budgetInr
  );

  const dynamicTestDest: ResolvedDestination = {
    id: slugifyDestinationId('Gokarna', 'Karnataka'),
    name: 'Gokarna',
    state: 'Karnataka',
    country: 'India',
    coordinates: { lat: 14.5479, lng: 74.3188 },
    locationType: 'beach',
    geographicRegion: 'South India',
    displayLabel: 'Gokarna, Karnataka',
    summary: 'Coastal temple and beach town in Karnataka (South India).',
    source: 'osm_nominatim',
  };
  assert.equal(
    Object.keys(
      validateTripPlanInput({
        destinationId: dynamicTestDest.id,
        destination: dynamicTestDest,
        startDate: '2026-12-10',
        days: 4,
        travellers: 2,
        budgetInr: 35000,
        intent: 'enjoy',
        interests: ['Beaches & Coastlines', 'Local Food & Cafes'],
      })
    ).length,
    0,
    'Dynamic Indian destination outside Himachal must pass validation'
  );
  console.log('✓ Verified pan-India input validation (accepts dynamic destinations, rejects invalid inputs).');

  // 3. Test live OpenStreetMap destination resolution + Overpass POI discovery + curated generation
  //    across Dehradun, Dharamshala, Manali, Gokarna, and Ziro (previously unsupported Northeast destination)
  const testTargets: Array<{
    query: string;
    expectedStateFragment: string;
    intent: TravelIntent;
    days: number;
    fallbackDest: ResolvedDestination;
  }> = [
    {
      query: 'Dehradun',
      expectedStateFragment: 'Uttarakhand',
      intent: 'travel',
      days: 4,
      fallbackDest: {
        id: 'dehradun-uttarakhand',
        name: 'Dehradun',
        state: 'Uttarakhand',
        country: 'India',
        coordinates: { lat: 30.3165, lng: 78.0322 },
        locationType: 'city',
        geographicRegion: 'North India (Himalayas)',
        displayLabel: 'Dehradun, Uttarakhand',
        summary: 'Foothills capital city in Uttarakhand.',
        source: 'osm_nominatim',
      },
    },
    {
      query: 'Dharamshala',
      expectedStateFragment: 'Himachal',
      intent: 'trek',
      days: 4,
      fallbackDest: {
        id: 'dharamshala-himachal-pradesh',
        name: 'Dharamshala',
        state: 'Himachal Pradesh',
        country: 'India',
        coordinates: { lat: 32.219, lng: 76.3234 },
        locationType: 'hill_station',
        geographicRegion: 'North India (Himalayas)',
        displayLabel: 'Dharamshala, Himachal Pradesh',
        summary: 'Dhauladhar hill station in Kangra Valley, Himachal Pradesh.',
        source: 'osm_nominatim',
      },
    },
    {
      query: 'Manali',
      expectedStateFragment: 'Himachal',
      intent: 'adventure',
      days: 5,
      fallbackDest: seeds[0],
    },
    {
      query: 'Gokarna',
      expectedStateFragment: 'Karnataka',
      intent: 'enjoy',
      days: 4,
      fallbackDest: dynamicTestDest,
    },
    {
      query: 'Ziro, Arunachal Pradesh',
      expectedStateFragment: 'Arunachal',
      intent: 'rest',
      days: 3,
      fallbackDest: {
        id: 'ziro-arunachal-pradesh',
        name: 'Ziro',
        state: 'Arunachal Pradesh',
        country: 'India',
        coordinates: { lat: 27.5449, lng: 93.8197 },
        locationType: 'valley',
        geographicRegion: 'East & Northeast India',
        displayLabel: 'Ziro, Arunachal Pradesh',
        summary: 'Apatani pine plateau valley in Arunachal Pradesh.',
        source: 'osm_nominatim',
      },
    },
  ];

  let liveGeocodedCount = 0;
  let liveOverpassVerifiedCount = 0;

  for (const target of testTargets) {
    const searchOutcome = await searchIndianDestinations(target.query);
    let resolved: ResolvedDestination;

    if (searchOutcome.status === 'ok' && searchOutcome.results.length > 0) {
      resolved = searchOutcome.results[0];
      liveGeocodedCount++;
      assert.ok(
        resolved.state.toLowerCase().includes(target.expectedStateFragment.toLowerCase()) ||
          resolved.displayLabel.toLowerCase().includes(target.expectedStateFragment.toLowerCase()),
        `Expected state containing "${target.expectedStateFragment}" for ${target.query}, got "${resolved.displayLabel}"`
      );
      assert.ok(Number.isFinite(resolved.coordinates.lat) && Number.isFinite(resolved.coordinates.lng));
      assert.ok(resolved.locationType.length > 0);
      assert.ok(resolved.geographicRegion.length > 0);
    } else {
      console.log(
        `  ! Live geocoding returned status="${searchOutcome.status}" for "${target.query}" (${searchOutcome.message ?? 'no message'}); using coordinate fallback for engine test.`
      );
      resolved = target.fallbackDest;
    }

    const discovery = await discoverNearbyForDestination(resolved);
    if (discovery.discoveryStatus === 'verified' || discovery.discoveryStatus === 'partial') {
      liveOverpassVerifiedCount++;
    }

    const planInput: TripPlanInput = {
      destinationId: resolved.id,
      destination: resolved,
      startDate: '2026-12-15',
      days: target.days,
      travellers: 2,
      budgetInr: 42000,
      intent: target.intent,
      interests: ['Nature & Forests', 'Local Food & Cafes', 'Heritage & Architecture'],
    };

    const options = generateThreeItineraryOptions(planInput, discovery);
    assert.equal(options.length, 3, `Must generate 3 tiers for ${target.query}`);
    assert.deepEqual(
      options.map((o) => o.styleLabel),
      ['Budget', 'Experience', 'Luxury']
    );

    for (const opt of options) {
      for (const item of opt.items) {
        assert.ok(
          item.dayNumber >= 1 && item.dayNumber <= planInput.days,
          `Item ${item.id} exceeded day limit (${item.dayNumber} > ${planInput.days})`
        );
        assert.ok(item.estimatedTravelTimeLabel.length > 0);
      }
      assertFirestoreRuleCompatibility(
        opt.destinationId,
        opt.destinationName,
        opt.stopNames,
        opt.items,
        opt.estimatedTotalInr
      );
      assert.ok(opt.costBreakdown.accommodationInr > 0);
      assert.ok(opt.costBreakdown.transportationInr > 0);
      assert.ok(opt.costBreakdown.foodInr > 0);
    }

    // Verify dynamic replacement & live total recalculation works for every Indian destination
    const expOption = options[1];
    const stayItem = expOption.items.find((i) => i.itemType === 'accommodation');
    assert.ok(stayItem, `Expected stay item for ${target.query}`);
    const stayReplacements = getReplacementCatalogOptions(stayItem, discovery);
    assert.ok(stayReplacements.length >= 2, `Expected contextual stay tier replacements for ${target.query}`);

    const swapChoice = stayReplacements[0];
    const swappedItems = applyItemReplacement(expOption.items, stayItem.id, swapChoice);
    const expectedDelta = (swapChoice.unitCostInr - stayItem.unitCostInr) * stayItem.quantity;
    assert.equal(
      calculateCostBreakdown(swappedItems).totalInr,
      expOption.estimatedTotalInr + expectedDelta
    );

    if (discovery.pois.length > 0) {
      const addedPoiItem = createPoiItineraryItem(
        'verify-trip',
        1,
        planInput.travellers,
        discovery.pois[0],
        99
      );
      const afterAdd = calculateCostBreakdown([...swappedItems, addedPoiItem]);
      assert.equal(
        afterAdd.totalInr,
        calculateCostBreakdown(swappedItems).totalInr +
          discovery.pois[0].estimatedPerPersonInr * planInput.travellers
      );
    }

    console.log(
      `✓ ${resolved.displayLabel} [${resolved.locationType} · ${resolved.geographicRegion}] → ` +
        `OSM discovery: ${discovery.discoveryStatus} (${discovery.pois.length} POIs, ${discovery.nearbyStops.length} nearby stops) · ` +
        `Stops: ${options[0].stopNames.join(' → ')} · ` +
        `Totals: ₹${options[0].estimatedTotalInr} / ₹${options[1].estimatedTotalInr} / ₹${options[2].estimatedTotalInr}`
    );
  }

  console.log(
    `\n✓ Pan-India live summary: ${liveGeocodedCount}/${testTargets.length} live-geocoded via OpenStreetMap, ${liveOverpassVerifiedCount}/${testTargets.length} live-enriched via Overpass API.`
  );

  // 4. Verify non-India query is honestly flagged as unsupported (not coerced into an Indian destination)
  const nonIndia = await searchIndianDestinations('Paris, France');
  if (nonIndia.status !== 'api_error') {
    assert.ok(
      nonIndia.status === 'unsupported_location' || nonIndia.status === 'no_results',
      `Expected unsupported_location or no_results for Paris, got ${nonIndia.status}`
    );
    console.log(`✓ Verified non-India location handling ("Paris, France" → status: ${nonIndia.status}).`);
  } else {
    console.log('! Skipped live non-India assertion due to network error.');
  }

  // 5. Verify all 5 travel intents work on a dynamic non-Himachal destination (Gokarna)
  const intents: TravelIntent[] = ['rest', 'enjoy', 'travel', 'trek', 'adventure'];
  for (const intent of intents) {
    const opts = generateThreeItineraryOptions({
      destinationId: dynamicTestDest.id,
      destination: dynamicTestDest,
      startDate: '2026-12-20',
      days: 3,
      travellers: 2,
      budgetInr: 30000,
      intent,
      interests: [],
    });
    assert.equal(opts.length, 3);
    for (const opt of opts) {
      assertFirestoreRuleCompatibility(
        opt.destinationId,
        opt.destinationName,
        opt.stopNames,
        opt.items,
        opt.estimatedTotalInr
      );
    }
  }
  console.log('✓ Verified all 5 travel intents (Rest, Enjoy, Travel, Trek, Adventure) on dynamic Indian destination.');

  // 6. Verify sparse-OSM fallback creates honest partial itinerary without fabricating landmarks
  const remoteVillage: ResolvedDestination = {
    id: slugifyDestinationId('Turtuk', 'Ladakh'),
    name: 'Turtuk',
    state: 'Ladakh',
    country: 'India',
    coordinates: { lat: 34.8473, lng: 76.8273 },
    locationType: 'village',
    geographicRegion: 'North India (Himalayas)',
    displayLabel: 'Turtuk, Ladakh',
    summary: 'Remote Nubra valley village in Ladakh.',
    source: 'osm_nominatim',
  };
  const sparseDiscovery: DestinationDiscoveryResult = {
    destination: remoteVillage,
    discoveryStatus: 'fallback',
    statusMessage: 'Simulated sparse OpenStreetMap coverage.',
    pois: [],
    nearbyStops: [],
    fetchedAt: new Date().toISOString(),
    sourceLabel: 'Estimated Planning Guidance',
  };
  const fallbackOpts = generateThreeItineraryOptions(
    {
      destinationId: remoteVillage.id,
      destination: remoteVillage,
      startDate: '2026-07-01',
      days: 3,
      travellers: 2,
      budgetInr: 28000,
      intent: 'rest',
      interests: [],
    },
    sparseDiscovery
  );
  assert.equal(fallbackOpts[0].discoveryStatus, 'fallback');
  assert.ok(
    fallbackOpts[0].items.every((i) => i.dataOrigin !== 'verified_osm'),
    'Fallback itinerary must never claim verified_osm origin when OSM returned zero POIs'
  );
  assertFirestoreRuleCompatibility(
    fallbackOpts[0].destinationId,
    fallbackOpts[0].destinationName,
    fallbackOpts[0].stopNames,
    fallbackOpts[0].items,
    fallbackOpts[0].estimatedTotalInr
  );
  console.log('✓ Verified honest sparse-OSM fallback itinerary (no fabricated landmarks, Firestore-safe).');

  // 7. Verify localStorage fallback persistence & deduplicated Cloud Firestore migration helper
  const store = new MemoryStorage();
  const sampleOption = fallbackOpts[1];
  const saved = saveTrip(
    {
      title: 'Ladakh Village Retreat',
      destinationId: sampleOption.destinationId,
      destinationName: sampleOption.destinationName,
      stopNames: sampleOption.stopNames,
      startDate: '2026-07-01',
      days: sampleOption.days,
      travellers: sampleOption.travellers,
      budgetInr: sampleOption.budgetInr,
      intent: sampleOption.intent,
      style: sampleOption.style,
      interests: [],
      items: sampleOption.items,
      budgetExplanation: sampleOption.budgetExplanation,
      status: 'planned',
      provenance: SAMPLE_PROVENANCE,
    },
    undefined,
    store
  );

  const localSecond = saveTrip(
    {
      title: 'Gokarna Coastal Escape',
      destinationId: dynamicTestDest.id,
      destinationName: dynamicTestDest.displayLabel,
      stopNames: ['Gokarna'],
      startDate: '2026-12-20',
      days: 3,
      travellers: 2,
      budgetInr: 25000,
      intent: 'enjoy',
      style: 'budget_explorer',
      interests: ['Beaches & Coastlines'],
      items: generateThreeItineraryOptions({
        destinationId: dynamicTestDest.id,
        destination: dynamicTestDest,
        startDate: '2026-12-20',
        days: 3,
        travellers: 2,
        budgetInr: 25000,
        intent: 'enjoy',
        interests: ['Beaches & Coastlines'],
      })[0].items,
      budgetExplanation: 'Fits budget.',
      status: 'planned',
      provenance: SAMPLE_PROVENANCE,
    },
    undefined,
    store
  );

  const allLocal = listSavedTrips(store);
  assert.equal(allLocal.length, 2);

  const simulatedCloudTrips: TripRecord[] = [
    {
      ...saved,
      id: 'cloud-trip-001',
      ownerUid: 'uid-alice',
      localSourceId: saved.id,
    },
  ];
  const pendingMigration = filterUnmigratedLocalTrips(allLocal, simulatedCloudTrips);
  assert.equal(pendingMigration.length, 1);
  assert.equal(pendingMigration[0].id, localSecond.id);

  const cloudWithSignatureMatch: TripRecord[] = [
    ...simulatedCloudTrips,
    {
      ...localSecond,
      id: 'cloud-trip-002',
      ownerUid: 'uid-alice',
      localSourceId: undefined,
    },
  ];
  assert.equal(filterUnmigratedLocalTrips(allLocal, cloudWithSignatureMatch).length, 0);

  removeLocalTripsByIds([saved.id], store);
  assert.deepEqual(
    listSavedTrips(store).map((t) => t.id),
    [localSecond.id]
  );
  deleteSavedTrip(localSecond.id, store);
  assert.equal(listSavedTrips(store).length, 0);

  const enquiry = createBookingRequest(
    {
      itemType: 'accommodation',
      catalogId: 'stay-gokarna-karnataka-midrange',
      itemName: 'Boutique Guesthouse / Regional Stay (Gokarna)',
      destinationName: 'Gokarna',
      providerName: 'Unverified Estimated Stay Band (Marketplace Future Release)',
      preferredDate: '2026-12-20',
      durationUnits: 2,
      durationLabel: '2 nights (illustrative)',
      travellers: 2,
      estimatedTotalInr: 8400,
    },
    'Test Traveller',
    'traveller@example.com',
    'Checking coastal homestay availability.',
    store
  );
  assert.equal(enquiry.status, 'requested');
  assert.equal(listBookingRequests(store).length, 1);
  console.log('✓ Verified localStorage fallback, deduplicated Cloud Firestore migration, and unconfirmed enquiry logging.');

  // 8. Comprehensive Expense Tracking, Budget Progress & Over-Budget Verification (Feature 7)
  const expenseStore = new MemoryStorage();
  const twoTravellerOption = generateThreeItineraryOptions({
    destinationId: dynamicTestDest.id,
    destination: dynamicTestDest,
    startDate: '2026-12-20',
    days: 3,
    travellers: 2,
    budgetInr: 28000,
    intent: 'enjoy',
    interests: ['Beaches & Coastlines'],
  })[0];

  // Save a 2-traveller trip (with no expenses initially)
  let trackedTrip = saveTrip(
    {
      title: 'Gokarna 2-Traveller Expense Test',
      destinationId: twoTravellerOption.destinationId,
      destinationName: twoTravellerOption.destinationName,
      stopNames: twoTravellerOption.stopNames,
      startDate: '2026-12-20',
      days: 3,
      travellers: 2,
      budgetInr: 28000,
      intent: 'enjoy',
      style: twoTravellerOption.style,
      interests: ['Beaches & Coastlines'],
      items: twoTravellerOption.items,
      expenses: [],
      budgetExplanation: twoTravellerOption.budgetExplanation,
      status: 'planned',
      provenance: SAMPLE_PROVENANCE,
    },
    undefined,
    expenseStore
  );
  assert.ok(formatTripDateRange(trackedTrip.startDate, trackedTrip.days).includes('2026'));

  // 8a. Backward compatibility check: legacy trip with expenses: undefined
  const legacySummary = computeTripFinancialSummary({
    items: trackedTrip.items,
    estimatedTotalInr: trackedTrip.estimatedTotalInr,
    travellers: trackedTrip.travellers,
    expenses: undefined,
  });
  assert.equal(legacySummary.actualTotalInr, 0);
  assert.equal(legacySummary.remainingBudgetInr, legacySummary.estimatedTotalInr);
  assert.equal(legacySummary.budgetUtilizationPct, 0);
  assert.equal(legacySummary.actualPerTravellerAvgInr, 0);

  // 8b. Mark an itinerary activity completed WITHOUT recording an expense → actual MUST remain ₹0!
  const firstActivity = trackedTrip.items.find((i) => i.itemType === 'activity') ?? trackedTrip.items[0];
  assert.ok(firstActivity, 'Expected at least one itinerary item');
  const completedItems = trackedTrip.items.map((item) =>
    item.id === firstActivity.id ? { ...item, completed: true } : item
  );
  trackedTrip = saveTrip(
    {
      title: trackedTrip.title,
      destinationId: trackedTrip.destinationId,
      destinationName: trackedTrip.destinationName,
      stopNames: trackedTrip.stopNames,
      startDate: trackedTrip.startDate,
      days: trackedTrip.days,
      travellers: trackedTrip.travellers,
      budgetInr: trackedTrip.budgetInr,
      intent: trackedTrip.intent,
      style: trackedTrip.style,
      interests: trackedTrip.interests,
      items: completedItems,
      expenses: trackedTrip.expenses,
      budgetExplanation: trackedTrip.budgetExplanation,
      status: 'planned',
      provenance: trackedTrip.provenance,
    },
    trackedTrip.id,
    expenseStore
  );
  const progressAfterComplete = computeCompletionProgress(trackedTrip.items);
  const financeAfterCompleteNoExpense = computeTripFinancialSummary(trackedTrip);
  assert.ok(progressAfterComplete.completedCount === 1 && progressAfterComplete.percentage > 0);
  assert.equal(
    financeAfterCompleteNoExpense.actualTotalInr,
    0,
    'Completing an itinerary item without entering an expense must NEVER increase actual expenditure'
  );
  assert.equal(financeAfterCompleteNoExpense.budgetUtilizationPct, 0);

  // 8c. Record actual expense against the completed activity
  const nowIso = new Date().toISOString();
  const itemExp1: TripExpense = {
    id: getDeterministicItemExpenseId(firstActivity.id),
    tripId: trackedTrip.id,
    kind: 'itinerary_item',
    itineraryItemId: firstActivity.id,
    description: firstActivity.title,
    category: firstActivity.costCategory,
    amountInr: 4000,
    expenseDate: '2026-12-20',
    notes: 'Paid at counter',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  let expensesList = upsertExpenseInList(trackedTrip.expenses, itemExp1);
  let summary = computeTripFinancialSummary({ ...trackedTrip, expenses: expensesList });
  assert.equal(summary.actualTotalInr, 4000);
  assert.equal(summary.itemizedActualInr, 4000);
  assert.equal(summary.additionalActualInr, 0);
  assert.equal(summary.actualPerTravellerAvgInr, 2000, 'Equal average for 2 travellers must be 4000/2 = 2000');
  assert.equal(summary.remainingBudgetInr, summary.estimatedTotalInr - 4000);
  assert.equal(
    summary.budgetUtilizationPct,
    Math.round(((4000 / summary.estimatedTotalInr) * 100) * 10) / 10
  );

  const variance1 = computeItemExpenseVariance(firstActivity.estimatedCostInr, 4000);
  assert.equal(variance1.differenceInr, 4000 - firstActivity.estimatedCostInr);

  // 8d. Record ₹0 zero-cost expense on a second item
  const secondItem = trackedTrip.items.find((i) => i.id !== firstActivity.id)!;
  const zeroCostExp: TripExpense = {
    id: getDeterministicItemExpenseId(secondItem.id),
    tripId: trackedTrip.id,
    kind: 'itinerary_item',
    itineraryItemId: secondItem.id,
    description: secondItem.title,
    category: secondItem.costCategory,
    amountInr: 0,
    expenseDate: '2026-12-20',
    notes: 'Free public entry',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  expensesList = upsertExpenseInList(expensesList, zeroCostExp);
  assert.equal(findExpenseForItem(expensesList, secondItem.id)?.amountInr, 0);
  summary = computeTripFinancialSummary({ ...trackedTrip, expenses: expensesList });
  assert.equal(summary.actualTotalInr, 4000);
  assert.equal(summary.recordedItemExpenseCount, 2);

  // 8e. Edit existing expense in place (must NOT duplicate!)
  const editedItemExp1: TripExpense = {
    ...itemExp1,
    amountInr: 5200,
    updatedAt: new Date().toISOString(),
  };
  expensesList = upsertExpenseInList(expensesList, editedItemExp1);
  assert.equal(expensesList.length, 2, 'Editing an item expense must never create a duplicate');
  summary = computeTripFinancialSummary({ ...trackedTrip, expenses: expensesList });
  assert.equal(summary.actualTotalInr, 5200);
  assert.equal(summary.actualPerTravellerAvgInr, 2600);

  // 8f. Add additional unplanned expense (parking / shopping / extra food)
  const extraExp: TripExpense = {
    id: createAdditionalExpenseId(),
    tripId: trackedTrip.id,
    kind: 'additional',
    description: 'Beach parking & coconut water',
    category: 'parking',
    amountInr: 800,
    expenseDate: '2026-12-21',
    notes: 'Cash',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  expensesList = upsertExpenseInList(expensesList, extraExp);
  assert.equal(expensesList.length, 3);
  summary = computeTripFinancialSummary({ ...trackedTrip, expenses: expensesList });
  assert.equal(summary.itemizedActualInr, 5200);
  assert.equal(summary.additionalActualInr, 800);
  assert.equal(summary.actualTotalInr, 6000);
  assert.equal(summary.actualPerTravellerAvgInr, 3000);

  // 8g. Validate Firestore security rules compatibility for every expense payload
  for (const exp of expensesList) {
    assert.ok(exp.id.length >= 1 && exp.id.length <= 128 && FIRESTORE_ID_REGEX.test(exp.id));
    assert.ok(exp.amountInr >= 0 && Number.isInteger(exp.amountInr));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(exp.expenseDate));
    assert.ok(exp.description.length >= 1 && exp.description.length <= 160);
    assert.ok((exp.notes ?? '').length <= 300);
  }

  // 8h. Persist and simulate page reload from storage
  trackedTrip = saveTrip(
    {
      title: trackedTrip.title,
      destinationId: trackedTrip.destinationId,
      destinationName: trackedTrip.destinationName,
      stopNames: trackedTrip.stopNames,
      startDate: trackedTrip.startDate,
      days: trackedTrip.days,
      travellers: trackedTrip.travellers,
      budgetInr: trackedTrip.budgetInr,
      intent: trackedTrip.intent,
      style: trackedTrip.style,
      interests: trackedTrip.interests,
      items: trackedTrip.items,
      expenses: expensesList,
      budgetExplanation: trackedTrip.budgetExplanation,
      status: 'planned',
      provenance: trackedTrip.provenance,
    },
    trackedTrip.id,
    expenseStore
  );
  const reloadedTrips = listSavedTrips(expenseStore);
  assert.equal(reloadedTrips.length, 1);
  assert.equal(reloadedTrips[0].expenses?.length, 3);
  assert.equal(computeTripFinancialSummary(reloadedTrips[0]).actualTotalInr, 6000);

  // 8i. Delete the additional expense and verify recalculation
  expensesList = removeExpenseFromList(reloadedTrips[0].expenses, extraExp.id);
  summary = computeTripFinancialSummary({ ...reloadedTrips[0], expenses: expensesList });
  assert.equal(summary.additionalActualInr, 0);
  assert.equal(summary.actualTotalInr, 5200);
  assert.equal(summary.actualPerTravellerAvgInr, 2600);

  // 8j. Over-budget scenario: actual > estimated total trip cost
  const overBudgetExtra: TripExpense = {
    id: createAdditionalExpenseId(),
    tripId: trackedTrip.id,
    kind: 'additional',
    description: 'Emergency private cab upgrade & extra stay',
    category: 'transportation',
    amountInr: summary.estimatedTotalInr, // guarantees total actual = 5200 + estimatedTotalInr > estimatedTotalInr
    expenseDate: '2026-12-22',
    notes: 'Over-budget test',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const overBudgetSummary = computeTripFinancialSummary({
    ...reloadedTrips[0],
    expenses: upsertExpenseInList(expensesList, overBudgetExtra),
  });
  assert.equal(overBudgetSummary.isOverBudget, true);
  assert.equal(overBudgetSummary.overBudgetInr, 5200);
  assert.equal(overBudgetSummary.remainingBudgetInr, -5200);
  assert.ok(overBudgetSummary.budgetUtilizationPct > 100);
  assert.equal(overBudgetSummary.budgetUtilizationBarPct, 100);

  console.log(
    '✓ Verified actual expense tracking (completion independence, ₹0 zero-cost, edit deduplication, unplanned expenses, delete recalculation, reload persistence, backward compatibility, and over-budget warning math).'
  );

  // 9. Exact User Regression Scenario: ₹100 + ₹200 = ₹300, Edit ₹100→₹150 = ₹350 (no duplicate), Delete ₹200 = ₹150
  const actA = trackedTrip.items[0];
  const actB = trackedTrip.items[1];
  assert.ok(actA && actB, 'Expected at least 2 itinerary items for multi-activity expense test');

  const exp100: TripExpense = {
    id: getDeterministicItemExpenseId(actA.id),
    tripId: trackedTrip.id,
    kind: 'itinerary_item',
    itineraryItemId: actA.id,
    description: actA.title,
    category: actA.costCategory,
    amountInr: 100,
    expenseDate: '2026-12-20',
    notes: 'Ticket 1',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const exp200: TripExpense = {
    id: getDeterministicItemExpenseId(actB.id),
    tripId: trackedTrip.id,
    kind: 'itinerary_item',
    itineraryItemId: actB.id,
    description: actB.title,
    category: actB.costCategory,
    amountInr: 200,
    expenseDate: '2026-12-20',
    notes: 'Ticket 2',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  let regExpenses = upsertExpenseInList([], exp100);
  regExpenses = upsertExpenseInList(regExpenses, exp200);
  const sum300 = computeTripFinancialSummary({ ...trackedTrip, expenses: regExpenses });
  assert.equal(sum300.actualTotalInr, 300, 'Expected Actual Spent = ₹300');
  assert.equal(sum300.remainingBudgetInr, sum300.estimatedTotalInr - 300);
  assert.equal(sum300.actualPerTravellerAvgInr, 150, 'Expected ₹300 / 2 travellers = ₹150');
  assert.ok(
    sum300.budgetUtilizationPct > 0,
    `Small positive expense ₹300 must NEVER round down to 0% utilization (got ${sum300.budgetUtilizationPct}%)`
  );
  assert.ok(
    sum300.budgetUtilizationBarPct >= 2,
    'Budget utilization progress bar must show a visible segment whenever actualTotalInr > 0'
  );

  // Edit ₹100 → ₹150 (must replace in place → ₹350, never ₹450)
  const exp150: TripExpense = {
    ...exp100,
    amountInr: 150,
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  regExpenses = upsertExpenseInList(regExpenses, exp150);
  assert.equal(regExpenses.length, 2, 'Updating ₹100→₹150 must not create a duplicate record');
  const sum350 = computeTripFinancialSummary({ ...trackedTrip, expenses: regExpenses });
  assert.equal(sum350.actualTotalInr, 350, 'Expected Actual Spent = ₹350 (NOT ₹450)');

  // Defensive double-count protection: even if duplicate item expenses were passed directly
  const dupGuardSum = computeTripFinancialSummary({
    ...trackedTrip,
    expenses: [...regExpenses, exp100, exp150],
  });
  assert.equal(
    dupGuardSum.actualTotalInr,
    350,
    'computeTripFinancialSummary must defensively deduplicate expenses to prevent double-counting'
  );

  // Delete ₹200 expense → Actual Spent becomes ₹150
  regExpenses = removeExpenseFromList(regExpenses, exp200.id);
  const sum150 = computeTripFinancialSummary({ ...trackedTrip, expenses: regExpenses });
  assert.equal(sum150.actualTotalInr, 150, 'Expected Actual Spent = ₹150 after deleting ₹200 expense');
  assert.equal(sum150.remainingBudgetInr, sum150.estimatedTotalInr - 150);
  assert.equal(sum150.actualPerTravellerAvgInr, 75);

  console.log(
    `✓ Verified exact multi-expense regression (₹100+₹200=₹300 [${sum300.budgetUtilizationPct}%], edit ₹100→₹150=₹350 with zero duplication, delete ₹200=₹150).`
  );

  console.log('\nALL PAN-INDIA DISCOVERY, EXPENSE TRACKING & FIRESTORE COMPATIBILITY CHECKS PASSED.');
}

void run().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err);
  process.exit(1);
});
