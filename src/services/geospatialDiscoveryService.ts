import { EXPERIENCES, getDestinationById } from '../data/sampleCatalogue';
import {
  Coordinates,
  DestinationDiscoveryResult,
  DestinationLocationType,
  DiscoveredPoi,
  ExperienceCategory,
  NearbyStopCandidate,
  PoiCategory,
  ResolvedDestination,
  TravelIntent,
} from '../types/roamplan';
import {
  classifyLocationType,
  slugifyDestinationId,
} from './destinationService';

const POI_CACHE_STORAGE_KEY = 'roamplan_osm_poi_discovery_v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24-hour cache
const OVERPASS_TIMEOUT_MS = 4500;
const PHOTON_TIMEOUT_MS = 5000;
const MIN_OVERPASS_INTERVAL_MS = 350;
let lastOverpassRequestAt = 0;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const memoryDiscoveryCache = new Map<string, { timestamp: number; data: DestinationDiscoveryResult }>();

export function calculateHaversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

/**
 * Estimates road transit minutes from straight-line distance using conservative Indian terrain speed
 * & winding-road detour factors. Always presented to users as an approximate geographic estimate.
 */
export function estimateRoadMinutesFromCoordinates(
  distanceKm: number,
  destination: Pick<ResolvedDestination, 'geographicRegion' | 'locationType'>
): number {
  if (distanceKm <= 0.6) return 10;
  const isMountain =
    destination.geographicRegion === 'North India (Himalayas)' ||
    destination.locationType === 'hill_station' ||
    destination.locationType === 'valley';
  const roadMultiplier = isMountain ? 1.55 : 1.28;
  const avgSpeedKmh = isMountain ? 27 : 40;
  const approxRoadKm = distanceKm * roadMultiplier;
  return Math.max(10, Math.round((approxRoadKm / avgSpeedKmh) * 60));
}

function cacheKeyFor(dest: ResolvedDestination): string {
  return `${dest.id}|${dest.coordinates.lat.toFixed(2)},${dest.coordinates.lng.toFixed(2)}`;
}

function readPersistentDiscoveryCache(): Record<
  string,
  { timestamp: number; data: DestinationDiscoveryResult }
> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(POI_CACHE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<
      string,
      { timestamp: number; data: DestinationDiscoveryResult }
    >;
  } catch {
    return {};
  }
}

function writePersistentDiscoveryCache(key: string, data: DestinationDiscoveryResult): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readPersistentDiscoveryCache();
    current[key] = { timestamp: Date.now(), data };
    const trimmed = Object.entries(current)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 25);
    window.localStorage.setItem(POI_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Non-fatal quota issue
  }
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function classifyOsmElement(tags: Record<string, string>): {
  category: PoiCategory;
  experienceCategory: Exclude<ExperienceCategory, 'transfer'>;
  suitableIntents: TravelIntent[];
  interestTags: string[];
  estimatedDurationHours: number;
  estimatedPerPersonInr: number;
  difficulty?: 'Easy' | 'Moderate' | 'Challenging';
  safetyNotes?: string;
} | null {
  const tourism = tags.tourism || '';
  const natural = tags.natural || '';
  const historic = tags.historic || '';
  const waterway = tags.waterway || '';
  const leisure = tags.leisure || '';
  const sport = tags.sport || '';
  const amenity = tags.amenity || '';
  const place = tags.place || '';

  // Lakes & Waterfalls
  if (
    waterway === 'waterfall' ||
    natural === 'waterfall' ||
    (natural === 'water' && (tags.water === 'lake' || tags.water === 'reservoir' || /lake|tal|sarovar|jheel|falls|waterfall/i.test(tags.name || '')))
  ) {
    const isWaterfall = waterway === 'waterfall' || natural === 'waterfall' || /fall/i.test(tags.name || '');
    return {
      category: 'lake_waterfall',
      experienceCategory: isWaterfall ? 'trek' : 'rest',
      suitableIntents: isWaterfall ? ['trek', 'enjoy', 'travel', 'adventure'] : ['rest', 'enjoy', 'travel'],
      interestTags: ['Lakes, Beaches & Waterfalls', 'Nature & Trails', 'Photography & Viewpoints'],
      estimatedDurationHours: isWaterfall ? 3 : 2,
      estimatedPerPersonInr: 150,
      difficulty: isWaterfall ? 'Easy' : undefined,
      safetyNotes: isWaterfall
        ? 'Rocky approaches near waterfalls can be slippery after rain. Wear grippy footwear and verify local trail access.'
        : undefined,
    };
  }

  // Viewpoints
  if (tourism === 'viewpoint') {
    return {
      category: 'viewpoint',
      experienceCategory: 'sightseeing',
      suitableIntents: ['enjoy', 'rest', 'travel', 'trek'],
      interestTags: ['Photography & Viewpoints', 'Nature & Trails'],
      estimatedDurationHours: 1.5,
      estimatedPerPersonInr: 100,
    };
  }

  // Adventure locations
  if (
    sport ||
    leisure === 'water_park' ||
    natural === 'peak' ||
    natural === 'cave_entrance' ||
    tags.route === 'hiking'
  ) {
    const isPeakOrTrail = natural === 'peak' || tags.route === 'hiking' || natural === 'cave_entrance';
    return {
      category: 'adventure_location',
      experienceCategory: isPeakOrTrail ? 'trek' : 'adventure',
      suitableIntents: isPeakOrTrail ? ['trek', 'adventure'] : ['adventure', 'enjoy'],
      interestTags: ['Adventure & Outdoors', 'Nature & Trails', 'Photography & Viewpoints'],
      estimatedDurationHours: isPeakOrTrail ? 4.5 : 3,
      estimatedPerPersonInr: isPeakOrTrail ? 900 : 1800,
      difficulty: isPeakOrTrail ? 'Moderate' : 'Moderate',
      safetyNotes:
        'Outdoor terrain and weather conditions vary seasonally. Verify local permits, operator credentials, and weather advisories in person.',
    };
  }

  // Cultural & Heritage locations
  if (
    historic ||
    tourism === 'museum' ||
    tourism === 'gallery' ||
    amenity === 'place_of_worship'
  ) {
    return {
      category: 'cultural_heritage',
      experienceCategory: 'food_culture',
      suitableIntents: ['enjoy', 'rest', 'travel'],
      interestTags: ['Heritage & Architecture', 'Art & Culture', 'Photography & Viewpoints'],
      estimatedDurationHours: 2,
      estimatedPerPersonInr: tourism === 'museum' || historic === 'fort' || historic === 'palace' ? 250 : 100,
    };
  }

  // Natural landmarks (beaches, springs, woods, reserves)
  if (
    natural === 'beach' ||
    natural === 'bay' ||
    natural === 'spring' ||
    natural === 'hot_spring' ||
    natural === 'cliff' ||
    leisure === 'nature_reserve' ||
    leisure === 'park' ||
    leisure === 'garden'
  ) {
    const isBeach = natural === 'beach' || natural === 'bay';
    return {
      category: 'natural_landmark',
      experienceCategory: isBeach || natural === 'hot_spring' ? 'rest' : 'sightseeing',
      suitableIntents: isBeach ? ['rest', 'enjoy', 'adventure', 'travel'] : ['rest', 'enjoy', 'trek'],
      interestTags: isBeach
        ? ['Lakes, Beaches & Waterfalls', 'Wellness & Slow Pace', 'Photography & Viewpoints']
        : ['Nature & Trails', 'Wellness & Slow Pace', 'Photography & Viewpoints'],
      estimatedDurationHours: isBeach ? 3 : 2.5,
      estimatedPerPersonInr: 150,
      safetyNotes: isBeach
        ? 'Check local tides and lifeguard flags before entering coastal waters.'
        : undefined,
    };
  }

  // Tourist attractions
  if (tourism === 'attraction' || tourism === 'zoo' || tourism === 'theme_park') {
    return {
      category: 'tourist_attraction',
      experienceCategory: 'sightseeing',
      suitableIntents: ['enjoy', 'travel', 'rest'],
      interestTags: ['Heritage & Architecture', 'Photography & Viewpoints', 'Art & Culture'],
      estimatedDurationHours: 2.5,
      estimatedPerPersonInr: 300,
    };
  }

  // Popular local areas / markets
  if (amenity === 'marketplace' || place === 'suburb' || place === 'neighbourhood' || place === 'quarter') {
    return {
      category: 'local_area',
      experienceCategory: 'food_culture',
      suitableIntents: ['enjoy', 'rest', 'travel'],
      interestTags: ['Local Food & Markets', 'Art & Culture'],
      estimatedDurationHours: 2,
      estimatedPerPersonInr: 350,
    };
  }

  return null;
}

function describeOsmPoi(name: string, tags: Record<string, string>, distanceKm: number, destName: string): string {
  const parts: string[] = [];
  if (tags.description) {
    return tags.description.slice(0, 220);
  }
  const typeWord =
    tags.tourism ||
    tags.historic ||
    tags.natural ||
    tags.waterway ||
    tags.leisure ||
    tags.sport ||
    tags.amenity ||
    'point of interest';
  const readableType = typeWord.replace(/_/g, ' ');
  parts.push(
    `Mapped ${readableType} located approximately ${distanceKm.toFixed(1)} km from ${destName} (OpenStreetMap).`
  );
  if (tags.religion) {
    parts.push(`Cultural/spiritual site (${tags.religion}).`);
  }
  if (tags.elevation) {
    parts.push(`Recorded elevation: ${tags.elevation} m.`);
  }
  if (tags.opening_hours) {
    parts.push(`Listed hours: ${tags.opening_hours}.`);
  }
  return parts.join(' ');
}

function buildOverpassQuery(lat: number, lng: number): string {
  const poiRadius = 15000; // 15 km for attractions, viewpoints, museums, beaches, heritage
  const natureRadius = 18000; // 18 km for waterfalls, peaks, springs, adventure spots
  const nearbyTownRadius = 50000; // 50 km for multi-stop candidate towns/cities

  return `[out:json][timeout:10];
(
  node["name"]["tourism"~"^(attraction|viewpoint|museum|gallery)$"](around:${poiRadius},${lat},${lng});
  way["name"]["tourism"~"^(attraction|viewpoint|museum)$"](around:10000,${lat},${lng});
  node["name"]["natural"~"^(waterfall|peak|beach|spring|hot_spring|cave_entrance|cliff)$"](around:${natureRadius},${lat},${lng});
  node["name"]["waterway"="waterfall"](around:${natureRadius},${lat},${lng});
  node["name"]["historic"~"^(monument|fort|castle|palace|ruins|memorial|archaeological_site)$"](around:${poiRadius},${lat},${lng});
  node["name"]["leisure"~"^(nature_reserve|park|garden)$"](around:10000,${lat},${lng});
  node["name"]["amenity"="marketplace"](around:8000,${lat},${lng});
  node["name"]["sport"~"^(paragliding|surfing|climbing|rafting|kayaking|skiing|scuba_diving)$"](around:${natureRadius},${lat},${lng});
  node["name"]["place"~"^(town|city)$"](around:${nearbyTownRadius},${lat},${lng});
);
out center 80;`;
}

async function querySingleOverpassMirror(endpoint: string, queryBody: string): Promise<OverpassElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(queryBody)}`,
    });
    if (!response.ok) {
      throw new Error(`Overpass HTTP ${response.status}`);
    }
    const json = (await response.json()) as { elements?: OverpassElement[] };
    if (!Array.isArray(json.elements)) {
      throw new Error('Malformed Overpass response');
    }
    return json.elements;
  } finally {
    clearTimeout(timer);
  }
}

async function queryOverpass(lat: number, lng: number): Promise<OverpassElement[]> {
  const queryBody = buildOverpassQuery(lat, lng);

  const elapsed = Date.now() - lastOverpassRequestAt;
  if (elapsed < MIN_OVERPASS_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_OVERPASS_INTERVAL_MS - elapsed));
  }
  lastOverpassRequestAt = Date.now();

  return Promise.any(OVERPASS_ENDPOINTS.map((ep) => querySingleOverpassMirror(ep, queryBody)));
}

interface PhotonPoiFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    countrycode?: string;
  };
}

const EXCLUDED_PHOTON_VALUES = new Set([
  'hotel',
  'guest_house',
  'hostel',
  'motel',
  'apartment',
  'chalet',
  'resort',
  'camp_site',
  'caravan_site',
]);

async function fetchPhotonJson(url: string): Promise<PhotonPoiFeature[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) return [];
    const payload = (await response.json()) as { features?: PhotonPoiFeature[] };
    return Array.isArray(payload.features) ? payload.features : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Polite secondary OpenStreetMap POI & nearby-town discovery via Komoot Photon (OpenStreetMap data)
 * used automatically whenever public Overpass mirrors are busy or unreachable.
 */
async function queryPhotonOsmElements(destination: ResolvedDestination): Promise<OverpassElement[]> {
  const { lat, lng } = destination.coordinates;
  const poiDelta = 0.24; // ~24 km box
  const poiBbox = `${(lng - poiDelta).toFixed(3)},${(lat - poiDelta).toFixed(3)},${(
    lng + poiDelta
  ).toFixed(3)},${(lat + poiDelta).toFixed(3)}`;

  const townDelta = 0.55; // ~55 km box for nearby multi-stop towns
  const townBbox = `${(lng - townDelta).toFixed(3)},${(lat - townDelta).toFixed(3)},${(
    lng + townDelta
  ).toFixed(3)},${(lat + townDelta).toFixed(3)}`;

  const probeTerms: string[] =
    destination.locationType === 'beach'
      ? ['beach', 'fort', 'temple', 'viewpoint']
      : destination.locationType === 'heritage'
      ? ['fort', 'palace', 'museum', 'temple']
      : destination.locationType === 'hill_station' || destination.locationType === 'valley'
      ? ['viewpoint', 'waterfall', 'lake', 'temple']
      : ['park', 'museum', 'temple', 'viewpoint'];

  const poiTagParams =
    'osm_tag=tourism:attraction&osm_tag=tourism:viewpoint&osm_tag=tourism:museum&osm_tag=tourism:gallery&osm_tag=natural:beach&osm_tag=natural:waterfall&osm_tag=natural:peak&osm_tag=natural:spring&osm_tag=historic&osm_tag=leisure:park&osm_tag=leisure:nature_reserve&osm_tag=amenity:place_of_worship&osm_tag=amenity:marketplace';

  const collected: OverpassElement[] = [];
  const seenKeys = new Set<string>();

  const pushFeature = (feat: PhotonPoiFeature) => {
    const coords = feat.geometry?.coordinates;
    const props = feat.properties;
    if (!coords || coords.length < 2 || !props?.name) return;
    if (props.countrycode && props.countrycode.toUpperCase() !== 'IN') return;
    const osmKey = props.osm_key || '';
    const osmValue = props.osm_value || '';
    if (!osmKey || !osmValue || EXCLUDED_PHOTON_VALUES.has(osmValue)) return;

    const dedupeKey = `${props.osm_type ?? 'N'}-${props.osm_id ?? props.name.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);

    collected.push({
      type: props.osm_type === 'W' ? 'way' : props.osm_type === 'R' ? 'relation' : 'node',
      id: props.osm_id ?? Math.abs(props.name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)),
      lat: coords[1],
      lon: coords[0],
      tags: {
        name: props.name,
        [osmKey]: osmValue,
      },
    });
  };

  // Query destination name + 4 tailored POI category probes politely in small pairs (prevents 429)
  const queries = [destination.name, ...probeTerms];
  for (let i = 0; i < queries.length; i += 2) {
    const batch = queries.slice(i, i + 2);
    const batchResults = await Promise.all(
      batch.map((term) =>
        fetchPhotonJson(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(
            term
          )}&lat=${lat}&lon=${lng}&bbox=${poiBbox}&${poiTagParams}&limit=8&lang=en`
        )
      )
    );
    batchResults.flat().forEach(pushFeature);
    if (i + 2 < queries.length) {
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
  }

  // Polite nearby towns probe for multi-location routing (12–55 km)
  await new Promise((resolve) => setTimeout(resolve, 220));
  const nearbyTownFeatures = await fetchPhotonJson(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(
      destination.state !== 'India' ? destination.state : 'a'
    )}&lat=${lat}&lon=${lng}&bbox=${townBbox}&osm_tag=place:town&osm_tag=place:city&limit=8&lang=en`
  );
  nearbyTownFeatures.forEach(pushFeature);

  return collected;
}

function getCuratedSeedPois(dest: ResolvedDestination): DiscoveredPoi[] {
  if (!dest.curatedSeedId) return [];
  const exps = EXPERIENCES.filter(
    (e) => e.destinationId === dest.curatedSeedId && e.category !== 'transfer' && e.published
  );
  return exps.map((e, idx) => {
    const poiCategory: PoiCategory =
      e.category === 'trek' || e.category === 'adventure'
        ? 'adventure_location'
        : e.category === 'food_culture'
        ? 'cultural_heritage'
        : e.category === 'rest'
        ? 'natural_landmark'
        : 'tourist_attraction';

    return {
      id: e.id,
      name: e.name,
      category: poiCategory,
      experienceCategory: e.category as Exclude<ExperienceCategory, 'transfer'>,
      coordinates: dest.coordinates,
      distanceKm: Math.max(1, Math.round((e.estimatedTravelMinutes / 3) * 10) / 10),
      estimatedTravelMinutes: e.estimatedTravelMinutes,
      destinationId: dest.id,
      destinationName: dest.name,
      summary: e.summary,
      osmTags: { source: 'curated_seed_example', index: String(idx + 1) },
      dataOrigin: 'curated_seed',
      suitableIntents: e.suitableIntents,
      interestTags: e.interestTags,
      estimatedDurationHours: e.durationHours,
      estimatedPerPersonInr: e.estimatedPerPersonInr,
      difficulty: e.difficulty,
      safetyNotes: e.safetyNotes,
      seasonNotes: e.seasonNotes,
      providerName: e.providerName,
    };
  });
}

function getCuratedSeedNearbyStops(dest: ResolvedDestination): NearbyStopCandidate[] {
  if (!dest.curatedSeedId) return [];
  const seed = getDestinationById(dest.curatedSeedId);
  if (!seed) return [];
  const curatedCoords: Record<string, Coordinates> = {
    manali: { lat: 32.2432, lng: 77.1892 },
    'solang-valley': { lat: 32.3161, lng: 77.1574 },
    sissu: { lat: 32.4795, lng: 77.1319 },
    kasol: { lat: 32.01, lng: 77.315 },
    shimla: { lat: 31.1048, lng: 77.1734 },
    'old-manali': { lat: 32.2543, lng: 77.1818 },
    naggar: { lat: 32.1135, lng: 77.1636 },
  };
  return seed.nearbyDestinationIds
    .map((id) => getDestinationById(id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .map((n) => {
      const coords = curatedCoords[n.id] ?? dest.coordinates;
      const dist = calculateHaversineKm(dest.coordinates, coords);
      return {
        id: n.id,
        name: n.name,
        state: 'Himachal Pradesh',
        coordinates: coords,
        distanceKm: dist,
        estimatedRoadMinutes: estimateRoadMinutesFromCoordinates(dist, dest),
        locationType: 'valley' as DestinationLocationType,
        dataOrigin: 'curated_seed' as const,
      };
    });
}

/**
 * Discovers verified OpenStreetMap points of interest and nearby candidate stops around any
 * resolved Indian destination. Caches results for 24h and never invents fake attraction names.
 */
export async function discoverNearbyForDestination(
  destination: ResolvedDestination
): Promise<DestinationDiscoveryResult> {
  const key = cacheKeyFor(destination);

  const memHit = memoryDiscoveryCache.get(key);
  if (memHit && Date.now() - memHit.timestamp < CACHE_TTL_MS) {
    return memHit.data;
  }

  const diskHit = readPersistentDiscoveryCache()[key];
  if (diskHit && Date.now() - diskHit.timestamp < CACHE_TTL_MS) {
    memoryDiscoveryCache.set(key, diskHit);
    return diskHit.data;
  }

  const seedPois = getCuratedSeedPois(destination);
  const seedNearby = getCuratedSeedNearbyStops(destination);

  let elements: OverpassElement[] = [];
  let activeOsmSource: 'overpass' | 'photon' | 'none' = 'none';

  try {
    elements = await queryOverpass(destination.coordinates.lat, destination.coordinates.lng);
    if (elements.length > 0) {
      activeOsmSource = 'overpass';
    }
  } catch {
    // Fall through to Komoot Photon OpenStreetMap POI index
  }

  if (elements.length < 4) {
    try {
      const photonElements = await queryPhotonOsmElements(destination);
      if (photonElements.length > 0) {
        elements = [...elements, ...photonElements];
        if (activeOsmSource === 'none') {
          activeOsmSource = 'photon';
        }
      }
    } catch {
      // Fall through cleanly to honest partial/fallback result
    }
  }

  if (elements.length > 0) {

    const pois: DiscoveredPoi[] = [];
    const nearbyStops: NearbyStopCandidate[] = [];
    const seenPoiNames = new Set<string>(seedPois.map((p) => p.name.toLowerCase()));
    const seenStopNames = new Set<string>([
      destination.name.toLowerCase(),
      ...seedNearby.map((s) => s.name.toLowerCase()),
    ]);

    for (const el of elements) {
      const tags = el.tags;
      if (!tags) continue;
      const rawName = (tags['name:en'] || tags.name || '').trim();
      if (!rawName || rawName.length < 3 || rawName.length > 90) continue;

      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;

      const coords: Coordinates = {
        lat: Math.round(lat * 10000) / 10000,
        lng: Math.round(lng * 10000) / 10000,
      };
      const distanceKm = calculateHaversineKm(destination.coordinates, coords);

      // Extract nearby candidate stops for multi-location journeys (12 km to 55 km away)
      if (
        (tags.place === 'town' || tags.place === 'city' || tags.place === 'village') &&
        distanceKm >= 12 &&
        distanceKm <= 55
      ) {
        const stopKey = rawName.toLowerCase();
        if (!seenStopNames.has(stopKey)) {
          seenStopNames.add(stopKey);
          nearbyStops.push({
            id: slugifyDestinationId(rawName, destination.state),
            name: rawName,
            state: destination.state,
            coordinates: coords,
            distanceKm,
            estimatedRoadMinutes: estimateRoadMinutesFromCoordinates(distanceKm, destination),
            locationType: classifyLocationType(rawName, 'place', tags.place, destination.state),
            dataOrigin: 'verified_osm',
          });
        }
        continue;
      }

      // Limit place_of_worship noise so temples/churches don't crowd out natural & cultural variety
      if (
        tags.amenity === 'place_of_worship' &&
        !tags.historic &&
        !tags.tourism &&
        pois.filter((p) => p.category === 'cultural_heritage').length >= 4
      ) {
        continue;
      }

      const classified = classifyOsmElement(tags);
      if (!classified) continue;

      const normalizedName = rawName.toLowerCase();
      if (seenPoiNames.has(normalizedName)) continue;
      seenPoiNames.add(normalizedName);

      const estMins = estimateRoadMinutesFromCoordinates(distanceKm, destination);
      pois.push({
        id: `osm-${el.type}-${el.id}`,
        name: rawName,
        category: classified.category,
        experienceCategory: classified.experienceCategory,
        coordinates: coords,
        distanceKm,
        estimatedTravelMinutes: estMins,
        destinationId: destination.id,
        destinationName: destination.name,
        summary: describeOsmPoi(rawName, tags, distanceKm, destination.name),
        osmTags: {
          ...(tags.tourism ? { tourism: tags.tourism } : {}),
          ...(tags.natural ? { natural: tags.natural } : {}),
          ...(tags.historic ? { historic: tags.historic } : {}),
          ...(tags.waterway ? { waterway: tags.waterway } : {}),
          ...(tags.sport ? { sport: tags.sport } : {}),
        },
        dataOrigin: 'verified_osm',
        suitableIntents: classified.suitableIntents,
        interestTags: classified.interestTags,
        estimatedDurationHours: classified.estimatedDurationHours,
        estimatedPerPersonInr: classified.estimatedPerPersonInr,
        difficulty: classified.difficulty,
        safetyNotes: classified.safetyNotes,
        seasonNotes: 'Verify local opening hours, seasonal access, and weather advisories locally.',
        providerName: 'OpenStreetMap Mapped Location (Verify Entry Locally)',
      });
    }

    // Sort POIs so distinct categories and closer iconic landmarks surface first
    pois.sort((a, b) => {
      const aPriority = a.category === 'local_area' ? 2 : 0;
      const bPriority = b.category === 'local_area' ? 2 : 0;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.distanceKm - b.distanceKm;
    });

    // Combine real OSM discoveries with any curated seed examples (for Himachal seed destinations)
    const combinedPois = [...pois.slice(0, 24), ...seedPois];
    const combinedNearby = [
      ...seedNearby,
      ...nearbyStops.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 6),
    ].slice(0, 6);

    const status: DestinationDiscoveryResult['discoveryStatus'] =
      combinedPois.length >= 4 ? 'verified' : combinedPois.length > 0 ? 'partial' : 'fallback';

    const statusMessage =
      status === 'verified'
        ? `Discovered ${pois.length} verified OpenStreetMap landmarks and ${combinedNearby.length} nearby towns around ${destination.displayLabel}.`
        : status === 'partial'
        ? `OpenStreetMap returned limited mapped points of interest (${combinedPois.length}) around ${destination.displayLabel}. Remaining slots use clearly labelled estimated local planning guidance without inventing landmarks.`
        : `OpenStreetMap currently has sparse mapped attractions near ${destination.displayLabel}. Showing a transparent partial planning framework with estimated regional budgets—no fictional landmarks or hotels have been invented.`;

    const sourceProviderName =
      activeOsmSource === 'overpass'
        ? 'OpenStreetMap Overpass POI Data + RoamPlan Curation Engine'
        : 'OpenStreetMap Photon POI Index + RoamPlan Curation Engine';

    const result: DestinationDiscoveryResult = {
      destination,
      pois: combinedPois,
      nearbyStops: combinedNearby,
      discoveryStatus: status,
      statusMessage,
      fetchedAt: new Date().toISOString(),
      sourceLabel:
        pois.length > 0
          ? sourceProviderName
          : 'RoamPlan Estimated Regional Framework (Sparse OSM Coverage)',
    };

    memoryDiscoveryCache.set(key, { timestamp: Date.now(), data: result });
    writePersistentDiscoveryCache(key, result);
    return result;
  }

  // Graceful fallback when both Overpass and Photon OSM POI discovery return zero items
  const hasSeeds = seedPois.length > 0;
  const fallbackResult: DestinationDiscoveryResult = {
    destination,
    pois: seedPois,
    nearbyStops: seedNearby,
    discoveryStatus: hasSeeds ? 'partial' : 'fallback',
    statusMessage: hasSeeds
      ? `Live OpenStreetMap POI discovery is temporarily unreachable; displaying curated example attractions for ${destination.name} alongside estimated regional budgets.`
      : `OpenStreetMap currently returned no mapped attractions near ${destination.displayLabel}. Showing a sensible partial itinerary using estimated regional pacing and budget bands—no fictional landmarks, live availability, or verified hotel rates have been invented.`,
    fetchedAt: new Date().toISOString(),
    sourceLabel: hasSeeds
      ? 'Curated Seed Examples (Live OSM POI Discovery Unavailable)'
      : 'Partial Estimated Framework (Sparse OSM Coverage)',
  };

  memoryDiscoveryCache.set(key, { timestamp: Date.now(), data: fallbackResult });
  return fallbackResult;
}

export function formatPoiCategoryLabel(category: PoiCategory): string {
  switch (category) {
    case 'tourist_attraction':
      return 'Tourist Attraction';
    case 'natural_landmark':
      return 'Natural Landmark';
    case 'viewpoint':
      return 'Viewpoint';
    case 'lake_waterfall':
      return 'Lake & Waterfall';
    case 'cultural_heritage':
      return 'Cultural & Heritage';
    case 'adventure_location':
      return 'Adventure & Trail';
    case 'local_area':
      return 'Local Area';
  }
}
