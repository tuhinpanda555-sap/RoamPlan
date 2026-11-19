import { DESTINATIONS } from '../data/sampleCatalogue';
import {
  DestinationLocationType,
  DestinationSearchOutcome,
  IndianGeographicRegion,
  ResolvedDestination,
} from '../types/roamplan';

const SEARCH_CACHE_STORAGE_KEY = 'roamplan_osm_dest_search_v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours to respect OpenStreetMap Nominatim caching guidelines
const REQUEST_TIMEOUT_MS = 6500;
const MIN_NOMINATIM_INTERVAL_MS = 1100; // Respect Nominatim 1 request/sec policy

let lastNominatimRequestAt = 0;
const memorySearchCache = new Map<string, { timestamp: number; outcome: DestinationSearchOutcome }>();

// Approximate bounding box covering all of India (including J&K, Ladakh, Northeast, Andaman & Nicobar, Lakshadweep)
const INDIA_BOUNDS = {
  minLat: 6.4,
  maxLat: 37.3,
  minLng: 68.0,
  maxLng: 97.6,
};

export const INDIAN_STATES_AND_UTS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

const STATE_REGION_MAP: Record<string, IndianGeographicRegion> = {
  'himachal pradesh': 'North India (Himalayas)',
  uttarakhand: 'North India (Himalayas)',
  'jammu and kashmir': 'North India (Himalayas)',
  ladakh: 'North India (Himalayas)',
  sikkim: 'East & Northeast India',
  'arunachal pradesh': 'East & Northeast India',
  assam: 'East & Northeast India',
  meghalaya: 'East & Northeast India',
  manipur: 'East & Northeast India',
  mizoram: 'East & Northeast India',
  nagaland: 'East & Northeast India',
  tripura: 'East & Northeast India',
  'west bengal': 'East & Northeast India',
  odisha: 'East & Northeast India',
  bihar: 'East & Northeast India',
  jharkhand: 'East & Northeast India',
  rajasthan: 'North India (Plains & Desert)',
  delhi: 'North India (Plains & Desert)',
  'national capital territory of delhi': 'North India (Plains & Desert)',
  punjab: 'North India (Plains & Desert)',
  haryana: 'North India (Plains & Desert)',
  chandigarh: 'North India (Plains & Desert)',
  'uttar pradesh': 'North India (Plains & Desert)',
  goa: 'West & Coastal India',
  maharashtra: 'West & Coastal India',
  gujarat: 'West & Coastal India',
  'dadra and nagar haveli and daman and diu': 'West & Coastal India',
  karnataka: 'South India',
  kerala: 'South India',
  'tamil nadu': 'South India',
  'andhra pradesh': 'South India',
  telangana: 'South India',
  puducherry: 'South India',
  'madhya pradesh': 'Central India',
  chhattisgarh: 'Central India',
  'andaman and nicobar islands': 'Indian Islands',
  lakshadweep: 'Indian Islands',
};

const KNOWN_NON_INDIA_PLACES = new Set([
  'paris',
  'london',
  'tokyo',
  'new york',
  'dubai',
  'singapore',
  'bangkok',
  'bali',
  'kathmandu',
  'pokhara',
  'thimphu',
  'colombo',
  'zurich',
  'rome',
  'sydney',
  'toronto',
  'seoul',
  'amsterdam',
  'barcelona',
  'istanbul',
  'maldives',
  'vietnam',
  'hanoi',
  'phuket',
  'switzerland',
  'france',
  'japan',
  'usa',
  'uk',
  'europe',
]);

const CURATED_COORDS: Record<string, { lat: number; lng: number; locationType: DestinationLocationType }> = {
  manali: { lat: 32.2432, lng: 77.1892, locationType: 'hill_station' },
  'solang-valley': { lat: 32.3161, lng: 77.1574, locationType: 'valley' },
  sissu: { lat: 32.4795, lng: 77.1319, locationType: 'valley' },
  kasol: { lat: 32.01, lng: 77.315, locationType: 'valley' },
  shimla: { lat: 31.1048, lng: 77.1734, locationType: 'hill_station' },
  'old-manali': { lat: 32.2543, lng: 77.1818, locationType: 'village' },
  naggar: { lat: 32.1135, lng: 77.1636, locationType: 'heritage' },
};

/**
 * Curated Himachal seed examples retained as reference destinations (never a search limit).
 */
export function getCuratedSeedDestinations(): ResolvedDestination[] {
  return DESTINATIONS.filter((d) => d.published).map((d) => {
    const geo = CURATED_COORDS[d.id] ?? { lat: 32.2432, lng: 77.1892, locationType: 'hill_station' };
    return {
      id: d.id,
      name: d.name,
      state: 'Himachal Pradesh',
      district: d.region,
      country: 'India',
      coordinates: { lat: geo.lat, lng: geo.lng },
      locationType: geo.locationType,
      geographicRegion: 'North India (Himalayas)',
      displayLabel: `${d.name}, Himachal Pradesh`,
      summary: d.summary,
      source: 'curated_seed',
      curatedSeedId: d.id,
      imageUrl: d.imageUrl,
      imageAlt: d.imageAlt,
      imageCaption: d.imageCaption,
      elevationMeters: d.elevationMeters,
    };
  });
}

/**
 * Pan-India starter quick-search prompts shown in the autocomplete dropdown before typing.
 * These are search shortcuts across diverse Indian states—never a closed destination list.
 */
export const PAN_INDIA_QUICK_PROMPTS: Array<{
  query: string;
  label: string;
  state: string;
  typeHint: string;
}> = [
  { query: 'Dehradun', label: 'Dehradun', state: 'Uttarakhand', typeHint: 'Foothill Valley' },
  { query: 'Dharamshala', label: 'Dharamshala', state: 'Himachal Pradesh', typeHint: 'Hill Station' },
  { query: 'Gokarna', label: 'Gokarna', state: 'Karnataka', typeHint: 'Coastal Town' },
  { query: 'Manali', label: 'Manali', state: 'Himachal Pradesh', typeHint: 'Himalayan Valley' },
  { query: 'Udaipur', label: 'Udaipur', state: 'Rajasthan', typeHint: 'Heritage City' },
  { query: 'Hampi', label: 'Hampi', state: 'Karnataka', typeHint: 'Heritage Village' },
  { query: 'Shillong', label: 'Shillong', state: 'Meghalaya', typeHint: 'Northeast Hills' },
  { query: 'Ziro', label: 'Ziro', state: 'Arunachal Pradesh', typeHint: 'Alpine Valley' },
];

export function slugifyDestinationId(name: string, state: string): string {
  const combined = `${name}-${state}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return combined || 'india-destination';
}

export function normalizeIndianState(rawState?: string): string {
  if (!rawState) return 'India';
  const cleaned = rawState.trim();
  const lower = cleaned.toLowerCase();
  if (lower.includes('delhi')) return 'Delhi';
  if (lower.includes('jammu') && lower.includes('kashmir')) return 'Jammu and Kashmir';
  if (lower.includes('andaman')) return 'Andaman and Nicobar Islands';
  if (lower.includes('dadra') || lower.includes('daman')) {
    return 'Dadra and Nagar Haveli and Daman and Diu';
  }
  if (lower === 'orissa') return 'Odisha';
  if (lower === 'pondicherry') return 'Puducherry';
  if (lower === 'uttaranchal') return 'Uttarakhand';
  return cleaned;
}

export function classifyGeographicRegion(state: string, lat: number, lng: number): IndianGeographicRegion {
  const normalized = normalizeIndianState(state).toLowerCase();
  if (STATE_REGION_MAP[normalized]) {
    return STATE_REGION_MAP[normalized];
  }
  if (lat >= 29.5 && lng >= 74 && lng <= 81.5) return 'North India (Himalayas)';
  if (lng >= 85.5) return 'East & Northeast India';
  if (lat <= 15.5) return 'South India';
  if (lng <= 75.5 && lat <= 23.5) return 'West & Coastal India';
  if (lat >= 21 && lat <= 26.5 && lng >= 75 && lng <= 84) return 'Central India';
  return 'North India (Plains & Desert)';
}

export function classifyLocationType(
  name: string,
  osmClass: string,
  osmType: string,
  state: string
): DestinationLocationType {
  const lowerName = name.toLowerCase();
  const lowerType = `${osmClass}:${osmType}`.toLowerCase();
  const lowerState = state.toLowerCase();

  if (lowerName.includes('valley') || lowerType.includes('valley')) return 'valley';
  if (
    lowerName.includes('beach') ||
    lowerType.includes('beach') ||
    ['gokarna', 'varkala', 'kovalam', 'palolem', 'anjuna', 'baga', 'radhanagar', 'pondicherry', 'puducherry', 'alibaug', 'diu', 'tarkarli'].some(
      (coastal) => lowerName.includes(coastal)
    )
  ) {
    return 'beach';
  }
  if (
    lowerType.includes('peak') ||
    lowerType.includes('national_park') ||
    lowerType.includes('nature_reserve') ||
    lowerName.includes('sanctuary') ||
    lowerName.includes('national park')
  ) {
    return 'nature';
  }
  if (
    ['hampi', 'khajuraho', 'orchha', 'jaisalmer', 'udaipur', 'jaipur', 'jodhpur', 'varanasi', 'madurai', 'thanjavur', 'badami', 'mahabalipuram', 'ajanta', 'ellora'].some(
      (h) => lowerName.includes(h)
    )
  ) {
    return 'heritage';
  }
  if (
    ['himachal pradesh', 'uttarakhand', 'sikkim', 'ladakh', 'jammu and kashmir', 'meghalaya', 'arunachal pradesh'].includes(
      lowerState
    ) ||
    ['ooty', 'udhagamandalam', 'munnar', 'kodaikanal', 'coorg', 'madikeri', 'darjeeling', 'kalimpong', 'mahabaleshwar', 'lonavala', 'mount abu', 'chikmagalur', 'wayanad', 'coonoor', 'yercaud', 'pachmarhi'].some(
      (hill) => lowerName.includes(hill)
    )
  ) {
    if (osmType === 'village' || osmType === 'hamlet') return 'village';
    return 'hill_station';
  }

  if (osmType === 'city' || osmType === 'metropolis') return 'city';
  if (osmType === 'village' || osmType === 'hamlet') return 'village';
  if (osmType === 'town' || osmType === 'suburb' || osmType === 'municipality') return 'town';
  if (osmType === 'administrative' || osmType === 'district' || osmType === 'county' || osmType === 'state') {
    return 'region';
  }
  return 'town';
}

export function formatLocationTypeLabel(type: DestinationLocationType): string {
  switch (type) {
    case 'city':
      return 'City';
    case 'town':
      return 'Town';
    case 'village':
      return 'Village';
    case 'valley':
      return 'Valley';
    case 'hill_station':
      return 'Hill Station';
    case 'beach':
      return 'Coastal / Beach';
    case 'heritage':
      return 'Heritage Destination';
    case 'nature':
      return 'Nature & Wilderness';
    case 'region':
      return 'Tourist Region';
  }
}

function isWithinIndiaBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}

function readPersistentSearchCache(): Record<string, { timestamp: number; outcome: DestinationSearchOutcome }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SEARCH_CACHE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, { timestamp: number; outcome: DestinationSearchOutcome }>;
  } catch {
    return {};
  }
}

function writePersistentSearchCache(key: string, outcome: DestinationSearchOutcome): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readPersistentSearchCache();
    current[key] = { timestamp: Date.now(), outcome };
    // Keep at most 40 cached queries to stay lightweight
    const entries = Object.entries(current)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 40);
    window.localStorage.setItem(SEARCH_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Non-fatal storage quota error
  }
}

function getCachedSearch(normalizedQuery: string): DestinationSearchOutcome | null {
  const mem = memorySearchCache.get(normalizedQuery);
  if (mem && Date.now() - mem.timestamp < CACHE_TTL_MS) {
    return { ...mem.outcome, source: 'cache' };
  }
  const disk = readPersistentSearchCache()[normalizedQuery];
  if (disk && Date.now() - disk.timestamp < CACHE_TTL_MS) {
    memorySearchCache.set(normalizedQuery, disk);
    return { ...disk.outcome, source: 'cache' };
  }
  return null;
}

function saveCachedSearch(normalizedQuery: string, outcome: DestinationSearchOutcome): void {
  memorySearchCache.set(normalizedQuery, { timestamp: Date.now(), outcome });
  if (outcome.status === 'ok') {
    writePersistentSearchCache(normalizedQuery, outcome);
  }
}

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface NominatimItem {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  category?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    suburb?: string;
    county?: string;
    state_district?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
}

function mapNominatimToDestination(item: NominatimItem): ResolvedDestination | null {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!isWithinIndiaBounds(lat, lng)) return null;
  if (item.address?.country_code && item.address.country_code.toLowerCase() !== 'in') {
    return null;
  }

  const rawName =
    item.name ||
    item.address?.city ||
    item.address?.town ||
    item.address?.village ||
    item.address?.hamlet ||
    item.address?.county ||
    item.display_name?.split(',')[0] ||
    '';
  const name = rawName.trim();
  if (!name) return null;

  const state = normalizeIndianState(item.address?.state || item.address?.state_district || 'India');
  const district = item.address?.state_district || item.address?.county;
  const osmClass = item.category || item.class || 'place';
  const osmType = item.addresstype || item.type || 'town';
  const locationType = classifyLocationType(name, osmClass, osmType, state);
  const geographicRegion = classifyGeographicRegion(state, lat, lng);

  // Check if this matches one of our 7 curated Himachal seed examples (strictly to attach real photograph when matching!)
  const curatedMatch = getCuratedSeedDestinations().find(
    (seed) =>
      seed.name.toLowerCase() === name.toLowerCase() &&
      seed.state.toLowerCase() === state.toLowerCase()
  );

  const id = curatedMatch ? curatedMatch.id : slugifyDestinationId(name, state);

  return {
    id,
    name,
    state,
    district: district && district !== name ? district : undefined,
    country: 'India',
    coordinates: {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
    },
    locationType: curatedMatch?.locationType ?? locationType,
    geographicRegion,
    displayLabel: state !== 'India' && state.toLowerCase() !== name.toLowerCase() ? `${name}, ${state}` : name,
    summary:
      curatedMatch?.summary ??
      `${formatLocationTypeLabel(locationType)} in ${state} (${geographicRegion}), dynamically resolved via OpenStreetMap geocoding.`,
    source: 'osm_nominatim',
    curatedSeedId: curatedMatch?.id,
    imageUrl: curatedMatch?.imageUrl,
    imageAlt: curatedMatch?.imageAlt,
    imageCaption: curatedMatch?.imageCaption,
    elevationMeters: curatedMatch?.elevationMeters,
    osmId: item.osm_id ? `${item.osm_type ?? 'node'}/${item.osm_id}` : undefined,
  };
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

function mapPhotonToDestination(feature: PhotonFeature): ResolvedDestination | null {
  const coords = feature.geometry?.coordinates;
  const props = feature.properties;
  if (!coords || coords.length < 2 || !props) return null;
  const [lng, lat] = coords;
  if (!isWithinIndiaBounds(lat, lng)) return null;
  if (props.countrycode && props.countrycode.toUpperCase() !== 'IN') return null;

  const name = (props.name || props.city || '').trim();
  if (!name) return null;
  const state = normalizeIndianState(props.state || props.county || 'India');
  const locationType = classifyLocationType(
    name,
    props.osm_key || 'place',
    props.osm_value || 'town',
    state
  );
  const geographicRegion = classifyGeographicRegion(state, lat, lng);

  const curatedMatch = getCuratedSeedDestinations().find(
    (seed) =>
      seed.name.toLowerCase() === name.toLowerCase() &&
      seed.state.toLowerCase() === state.toLowerCase()
  );

  return {
    id: curatedMatch ? curatedMatch.id : slugifyDestinationId(name, state),
    name,
    state,
    district: props.county && props.county !== name ? props.county : undefined,
    country: 'India',
    coordinates: {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
    },
    locationType: curatedMatch?.locationType ?? locationType,
    geographicRegion,
    displayLabel: state !== 'India' && state.toLowerCase() !== name.toLowerCase() ? `${name}, ${state}` : name,
    summary:
      curatedMatch?.summary ??
      `${formatLocationTypeLabel(locationType)} in ${state} (${geographicRegion}), dynamically resolved via OpenStreetMap Photon.`,
    source: 'osm_photon',
    curatedSeedId: curatedMatch?.id,
    imageUrl: curatedMatch?.imageUrl,
    imageAlt: curatedMatch?.imageAlt,
    imageCaption: curatedMatch?.imageCaption,
    elevationMeters: curatedMatch?.elevationMeters,
    osmId: props.osm_id ? `${props.osm_type ?? 'N'}/${props.osm_id}` : undefined,
  };
}

function deduplicateDestinations(list: ResolvedDestination[]): ResolvedDestination[] {
  const seen = new Set<string>();
  const out: ResolvedDestination[] = [];
  for (const dest of list) {
    const key = `${dest.name.toLowerCase()}|${dest.state.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dest);
  }
  return out;
}

/**
 * Queries OpenStreetMap Nominatim (primary) with Photon fallback across all Indian states & UTs.
 * Respects OSM usage policy via 24h caching, client throttling, and polite Accept-Language headers.
 */
export async function searchIndianDestinations(rawQuery: string): Promise<DestinationSearchOutcome> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) {
    return {
      status: 'no_results',
      results: [],
      message: 'Type at least 2 characters to search any city, town, village, valley, or beach in India.',
    };
  }

  const normalizedKey = trimmed.toLowerCase().replace(/\s+/g, ' ');
  const cached = getCachedSearch(normalizedKey);
  if (cached) return cached;

  // Immediate unsupported check for clearly non-Indian cities/countries (supports "Paris" or "Paris, France")
  const querySegments = normalizedKey
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    KNOWN_NON_INDIA_PLACES.has(normalizedKey) ||
    querySegments.some((seg) => KNOWN_NON_INDIA_PLACES.has(seg))
  ) {
    return {
      status: 'unsupported_location',
      results: [],
      message: `“${trimmed}” appears to be outside India. RoamPlan currently supports destinations across all 28 Indian states and 8 union territories.`,
    };
  }

  // Also collect matching curated seed examples in case both public OSM mirrors are unreachable
  const seedMatches = getCuratedSeedDestinations().filter(
    (s) =>
      s.name.toLowerCase().includes(normalizedKey) ||
      s.state.toLowerCase().includes(normalizedKey) ||
      (s.district?.toLowerCase().includes(normalizedKey) ?? false)
  );

  let nominatimFailed = false;

  // 1. Primary: OpenStreetMap Nominatim restricted to countrycodes=in
  try {
    const elapsed = Date.now() - lastNominatimRequestAt;
    if (elapsed < MIN_NOMINATIM_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_NOMINATIM_INTERVAL_MS - elapsed));
    }
    lastNominatimRequestAt = Date.now();

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&addressdetails=1&limit=8&q=${encodeURIComponent(
      trimmed
    )}`;
    const response = await fetchWithTimeout(nominatimUrl, {
      'Accept-Language': 'en',
    });

    if (response.ok) {
      const payload = (await response.json()) as NominatimItem[];
      const resolved = deduplicateDestinations(
        payload
          .map(mapNominatimToDestination)
          .filter((d): d is ResolvedDestination => d !== null)
      ).slice(0, 6);

      if (resolved.length > 0) {
        const outcome: DestinationSearchOutcome = {
          status: 'ok',
          results: resolved,
          source: 'osm_nominatim',
        };
        saveCachedSearch(normalizedKey, outcome);
        return outcome;
      }
    } else {
      nominatimFailed = true;
    }
  } catch {
    nominatimFailed = true;
  }

  // 2. Secondary OSM-based geocoder: Komoot Photon bounded to India
  let photonFailed = false;
  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      `${trimmed}, India`
    )}&limit=8&lang=en&bbox=${INDIA_BOUNDS.minLng},${INDIA_BOUNDS.minLat},${INDIA_BOUNDS.maxLng},${INDIA_BOUNDS.maxLat}`;
    const response = await fetchWithTimeout(photonUrl);

    if (response.ok) {
      const payload = (await response.json()) as { features?: PhotonFeature[] };
      const resolved = deduplicateDestinations(
        (payload.features ?? [])
          .map(mapPhotonToDestination)
          .filter((d): d is ResolvedDestination => d !== null)
      ).slice(0, 6);

      if (resolved.length > 0) {
        const outcome: DestinationSearchOutcome = {
          status: 'ok',
          results: resolved,
          source: 'osm_photon',
        };
        saveCachedSearch(normalizedKey, outcome);
        return outcome;
      }
    } else {
      photonFailed = true;
    }
  } catch {
    photonFailed = true;
  }

  // 3. If curated seeds match while APIs failed, serve them with a clear note
  if (seedMatches.length > 0) {
    return {
      status: 'ok',
      results: seedMatches,
      source: 'curated_seed',
      message: nominatimFailed && photonFailed
        ? 'OpenStreetMap geocoding is temporarily unreachable; showing matching curated example destinations.'
        : undefined,
    };
  }

  // 4. Differentiate API outage vs genuine no-results / unsupported outside-India location
  if (nominatimFailed && photonFailed) {
    return {
      status: 'api_error',
      results: [],
      message:
        'Unable to reach OpenStreetMap geocoding services right now. Check your connection or retry in a moment.',
    };
  }

  // Check if query resolves outside India to show a helpful unsupported-location message
  try {
    const globalCheckUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(
      trimmed
    )}`;
    const res = await fetchWithTimeout(globalCheckUrl, { 'Accept-Language': 'en' });
    if (res.ok) {
      const globalData = (await res.json()) as NominatimItem[];
      if (globalData.length > 0 && globalData[0].address?.country_code?.toLowerCase() !== 'in') {
        const country = globalData[0].address?.country ?? 'outside India';
        return {
          status: 'unsupported_location',
          results: [],
          message: `“${trimmed}” resolves to ${country}. RoamPlan currently plans trips exclusively across Indian states and union territories.`,
        };
      }
    }
  } catch {
    // Ignore global check failure
  }

  return {
    status: 'no_results',
    results: [],
    message: `No matching Indian destination found for “${trimmed}”. Try adding the state name (e.g., “Ziro, Arunachal Pradesh” or “Gokarna, Karnataka”).`,
  };
}

/**
 * Resolves a single destination by free-text name (e.g., quick prompt click or URL state).
 */
export async function resolveDestinationByName(query: string): Promise<ResolvedDestination | null> {
  const outcome = await searchIndianDestinations(query);
  return outcome.results[0] ?? null;
}

export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}
