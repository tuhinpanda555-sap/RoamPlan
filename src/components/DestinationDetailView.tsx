import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Compass,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { getDestinationById } from '../data/sampleCatalogue';
import { buildContextualStayEstimate, formatInr } from '../engine/itineraryEngine';
import {
  formatCoordinates,
  formatLocationTypeLabel,
} from '../services/destinationService';
import {
  discoverNearbyForDestination,
  formatPoiCategoryLabel,
} from '../services/geospatialDiscoveryService';
import {
  BookingEnquiryDraft,
  DestinationDiscoveryResult,
  NearbyStopCandidate,
  PoiCategory,
  PriceTier,
  ResolvedDestination,
} from '../types/roamplan';
import { EditorialImage } from './EditorialImage';

interface DestinationDetailViewProps {
  destination: ResolvedDestination;
  onBack: () => void;
  onPlanHere: (destination: ResolvedDestination, discovery?: DestinationDiscoveryResult | null) => void;
  onExploreNearbyStop: (stop: NearbyStopCandidate, parent: ResolvedDestination) => void;
  onRequestEnquiry: (draft: BookingEnquiryDraft) => void;
}

export function DestinationDetailView({
  destination,
  onBack,
  onPlanHere,
  onExploreNearbyStop,
  onRequestEnquiry,
}: DestinationDetailViewProps) {
  const [discovery, setDiscovery] = useState<DestinationDiscoveryResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<PoiCategory | 'all'>('all');
  const [reloadTick, setReloadTick] = useState(0);

  const curatedSeedMeta = useMemo(
    () => (destination.curatedSeedId ? getDestinationById(destination.curatedSeedId) : undefined),
    [destination.curatedSeedId]
  );

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setCategoryFilter('all');

    void discoverNearbyForDestination(destination).then((result) => {
      if (!active) return;
      setDiscovery(result);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [destination.id, destination.coordinates.lat, destination.coordinates.lng, reloadTick]);

  const stayEstimates = useMemo(() => {
    return (['budget', 'midrange', 'luxury'] as PriceTier[]).map((tier) => ({
      tier,
      estimate: buildContextualStayEstimate(destination, tier),
    }));
  }, [destination]);

  const filteredPois = useMemo(() => {
    if (!discovery) return [];
    if (categoryFilter === 'all') return discovery.pois;
    return discovery.pois.filter((p) => p.category === categoryFilter);
  }, [discovery, categoryFilter]);

  const availableCategories = useMemo(() => {
    if (!discovery) return [];
    const set = new Set<PoiCategory>(discovery.pois.map((p) => p.category));
    return Array.from(set);
  }, [discovery]);

  const defaultDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const coordsLabel = formatCoordinates(destination.coordinates.lat, destination.coordinates.lng);

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-[#4B5650] hover:text-[#17211C] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Back to Explore</span>
      </button>

      {/* Editorial Destination Header */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-7">
          <figure className="h-full flex flex-col">
            <div className="aspect-[16/10] lg:flex-1 lg:min-h-[420px] overflow-hidden rounded-lg border border-[#DFD9CE] bg-[#E7E3D9]">
              <EditorialImage
                src={destination.imageUrl}
                alt={destination.imageAlt ?? `${destination.displayLabel} travel monograph`}
                title={destination.name}
                subtitle={`${destination.state} · ${destination.geographicRegion}`}
                coordinatesLabel={coordsLabel}
                className="w-full h-full object-cover"
              />
            </div>
            <figcaption className="mt-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#4B5650]">
              <span className="italic font-editorial text-sm">
                {destination.imageCaption ??
                  `${destination.displayLabel} — resolved via OpenStreetMap geocoding.`}
              </span>
              <span className="font-mono tabular-nums">{coordsLabel}</span>
            </figcaption>
          </figure>
        </div>

        <div className="lg:col-span-5 flex flex-col justify-between bg-white border border-[#DFD9CE] rounded-lg p-6 sm:p-7">
          <div>
            <p className="text-xs font-medium text-[#4B5650]">
              {formatLocationTypeLabel(destination.locationType)} · {destination.geographicRegion}
            </p>
            <h1 className="mt-2 font-editorial text-4xl sm:text-[42px] leading-[1.1] text-[#17211C]">
              {destination.name}
            </h1>
            <p className="mt-1 text-base font-medium text-[#4B5650]">
              {destination.state}
              {destination.district ? ` · ${destination.district}` : ''}
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-[#4B5650]">
              {curatedSeedMeta?.editorialOverview ?? destination.summary}
            </p>

            <dl className="mt-6 pt-5 border-t border-[#EFECE4] space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Coordinates</dt>
                <dd className="text-right font-mono tabular-nums text-[#17211C]">{coordsLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Location Type</dt>
                <dd className="text-right text-[#17211C]">
                  {formatLocationTypeLabel(destination.locationType)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Region</dt>
                <dd className="text-right text-[#17211C]">{destination.geographicRegion}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Location Source</dt>
                <dd className="text-right text-[#17211C]">
                  {destination.source === 'curated_seed'
                    ? 'Curated Example + Live OSM'
                    : destination.source === 'osm_photon'
                    ? 'OpenStreetMap (Photon)'
                    : 'OpenStreetMap (Nominatim)'}
                </dd>
              </div>
              {curatedSeedMeta && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[#4B5650]">Best Seasons</dt>
                  <dd className="text-right text-[#17211C] max-w-[62%]">
                    {curatedSeedMeta.bestSeasons}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="mt-7 pt-5 border-t border-[#EFECE4]">
            <button
              type="button"
              onClick={() => onPlanHere(destination, discovery)}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md transition-colors min-h-[48px]"
            >
              <span>Curate Itinerary for {destination.name}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Section 01: Nearby OpenStreetMap Landmarks & Attractions */}
      <section className="mt-14 pt-10 border-t border-[#DFD9CE]">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#4B5650]">
              01. Geospatial Discovery · OpenStreetMap Points of Interest
            </p>
            <h2 className="mt-1.5 font-editorial text-3xl text-[#17211C]">
              Attractions, landmarks & local areas around {destination.name}
            </h2>
          </div>

          {!isLoading && discovery && (
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#17211C] border border-[#CFC8BA] hover:bg-[#EFECE4] rounded-md transition-colors whitespace-nowrap shrink-0 self-start md:self-auto min-h-[38px]"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Refresh Discovery</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="mt-6 p-12 bg-white border border-[#DFD9CE] rounded-lg text-center">
            <Loader2 className="w-6 h-6 mx-auto text-[#1B4B3A] animate-spin" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-[#17211C]">
              Querying OpenStreetMap landmarks around {destination.displayLabel}…
            </p>
            <p className="mt-1 text-xs text-[#4B5650] font-mono tabular-nums">{coordsLabel}</p>
          </div>
        ) : discovery ? (
          <>
            {/* Honest Discovery Status Banner */}
            <div
              className={`mt-6 p-4 rounded-lg border flex items-start gap-3 text-sm ${
                discovery.discoveryStatus === 'verified'
                  ? 'bg-[#F1F6F3] border-[#CFE0D8] text-[#174233]'
                  : 'bg-[#FBF7F0] border-[#E6D6BC] text-[#6B3F10]'
              }`}
            >
              {discovery.discoveryStatus === 'verified' ? (
                <Info className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
              )}
              <div className="space-y-1">
                <p className="font-medium leading-relaxed">{discovery.statusMessage}</p>
                <p className="text-xs opacity-85">
                  Source: {discovery.sourceLabel}. Travel durations are coordinate-based road
                  estimates; verify opening hours and local conditions before visiting.
                </p>
              </div>
            </div>

            {/* Category Filter Tabs */}
            {availableCategories.length > 1 && (
              <div className="mt-6 flex flex-wrap items-center gap-1.5 p-1 bg-[#EFECE4] rounded-md w-fit">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap min-h-[36px] ${
                    categoryFilter === 'all'
                      ? 'bg-white text-[#17211C] shadow-xs'
                      : 'text-[#4B5650] hover:text-[#17211C]'
                  }`}
                >
                  All ({discovery.pois.length})
                </button>
                {availableCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3.5 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap min-h-[36px] ${
                      categoryFilter === cat
                        ? 'bg-white text-[#17211C] shadow-xs'
                        : 'text-[#4B5650] hover:text-[#17211C]'
                    }`}
                  >
                    {formatPoiCategoryLabel(cat)}
                  </button>
                ))}
              </div>
            )}

            {filteredPois.length === 0 ? (
              <div className="mt-6 p-10 bg-white border border-[#DFD9CE] rounded-lg text-center">
                <Compass className="w-7 h-7 mx-auto text-[#4B5650]" strokeWidth={1.5} aria-hidden="true" />
                <h3 className="mt-3 font-editorial text-2xl text-[#17211C]">
                  Sparse OpenStreetMap POI coverage for this area
                </h3>
                <p className="mt-2 text-sm text-[#4B5650] max-w-lg mx-auto leading-relaxed">
                  You can still generate a complete Budget, Experience, and Luxury planning
                  itinerary for {destination.displayLabel}. RoamPlan will build an honest partial
                  schedule using estimated regional pacing and budgets without inventing fictional
                  attractions.
                </p>
                <button
                  type="button"
                  onClick={() => onPlanHere(destination, discovery)}
                  className="mt-6 px-5 py-2.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md min-h-[44px]"
                >
                  Generate Partial Itinerary for {destination.name}
                </button>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredPois.slice(0, 16).map((poi) => (
                  <article
                    key={poi.id}
                    className="bg-white border border-[#DFD9CE] rounded-lg p-6 flex flex-col justify-between"
                  >
                    <div>
                      <p className="text-xs font-medium text-[#4B5650]">
                        {formatPoiCategoryLabel(poi.category)} ·{' '}
                        <span className="font-mono tabular-nums">
                          {poi.distanceKm.toFixed(1)} km
                        </span>{' '}
                        · ~<span className="font-mono tabular-nums">{poi.estimatedTravelMinutes} min</span>{' '}
                        est.
                        {poi.dataOrigin === 'verified_osm'
                          ? ' · Verified OSM'
                          : ' · Curated Example'}
                      </p>
                      <h3 className="mt-2 font-editorial text-2xl text-[#17211C]">{poi.name}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-[#4B5650]">{poi.summary}</p>

                      {poi.safetyNotes && (
                        <div className="mt-3 p-3 bg-[#FBF7F0] border border-[#E6D6BC] rounded-md flex items-start gap-2 text-xs text-[#6B3F10]">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                          <p className="leading-relaxed">{poi.safetyNotes}</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 pt-4 border-t border-[#EFECE4] flex items-center justify-between gap-3">
                      <div className="text-xs text-[#4B5650]">
                        <span className="font-mono tabular-nums text-sm font-medium text-[#17211C]">
                          Est. {formatInr(poi.estimatedPerPersonInr)}
                        </span>{' '}
                        / person · <span className="font-mono tabular-nums">{poi.estimatedDurationHours} hrs</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onRequestEnquiry({
                            itemType: 'experience',
                            catalogId: poi.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96),
                            itemName: poi.name,
                            destinationName: destination.displayLabel,
                            providerName: poi.providerName ?? 'Local Activity (Verify Locally)',
                            preferredDate: defaultDate,
                            durationUnits: poi.estimatedDurationHours,
                            durationLabel: `${poi.estimatedDurationHours} hrs`,
                            travellers: 2,
                            estimatedTotalInr: poi.estimatedPerPersonInr * 2,
                          })
                        }
                        className="px-3.5 py-2 text-xs font-semibold text-[#1B4B3A] border border-[#1B4B3A] hover:bg-[#1B4B3A] hover:text-[#F8F6F1] rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                      >
                        Planning Enquiry
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Nearby Multi-Stop Towns / Valleys */}
            {discovery.nearbyStops.length > 0 && (
              <div className="mt-12 pt-8 border-t border-[#DFD9CE]">
                <p className="text-xs font-medium text-[#4B5650]">
                  02. Nearby Destinations for Multi-Stop Journeys (12–55 km)
                </p>
                <h2 className="mt-1.5 font-editorial text-2xl sm:text-3xl text-[#17211C]">
                  Geographically feasible intermediary stops
                </h2>
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {discovery.nearbyStops.map((stop) => (
                    <button
                      key={stop.id}
                      type="button"
                      onClick={() => onExploreNearbyStop(stop, destination)}
                      className="text-left p-5 bg-white border border-[#DFD9CE] hover:border-[#1B4B3A] rounded-lg transition-colors flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <MapPin className="w-4 h-4 text-[#1B4B3A] shrink-0 mt-1" aria-hidden="true" />
                        <div>
                          <p className="font-editorial text-xl text-[#17211C]">{stop.name}</p>
                          <p className="mt-0.5 text-xs text-[#4B5650]">
                            {stop.state} · {formatLocationTypeLabel(stop.locationType)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums text-xs text-[#4B5650] shrink-0">
                        <p className="text-[#17211C] font-medium">{stop.distanceKm.toFixed(0)} km</p>
                        <p>~{stop.estimatedRoadMinutes} min</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>

      {/* Section 03: Contextual Stay Guidance (No Fabricated Hotel Listings) */}
      <section className="mt-14 pt-10 border-t border-[#DFD9CE]">
        <p className="text-xs font-medium text-[#4B5650]">
          03. Contextual Stay Planning Bands · Unverified Estimates
        </p>
        <h2 className="mt-1.5 font-editorial text-3xl text-[#17211C]">
          Estimated nightly accommodation tiers in {destination.name}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#4B5650] max-w-3xl">
          RoamPlan does not fabricate hotel names, live room availability, or unverified property
          reviews. Verified hotel and homestay inventory will arrive in a future marketplace release;
          use these regional planning bands to compare Budget, Experience, and Luxury trip totals.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {stayEstimates.map(({ tier, estimate }) => (
            <article
              key={tier}
              className="bg-white border border-[#DFD9CE] rounded-lg p-6 flex flex-col justify-between"
            >
              <div>
                <p className="text-xs font-medium text-[#4B5650]">
                  {tier === 'budget'
                    ? 'Budget Tier'
                    : tier === 'midrange'
                    ? 'Experience Tier'
                    : 'Luxury Tier'}{' '}
                  · Estimated Category
                </p>
                <h3 className="mt-1.5 font-editorial text-2xl text-[#17211C]">{estimate.title}</h3>
                <p className="mt-1 text-xs font-medium text-[#1B4B3A]">{estimate.propertyType}</p>
                <p className="mt-3 text-sm leading-relaxed text-[#4B5650]">{estimate.summary}</p>
              </div>

              <div className="mt-6 pt-4 border-t border-[#EFECE4] flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono tabular-nums text-lg font-medium text-[#17211C]">
                    {formatInr(estimate.estimatedNightlyInr)}
                    <span className="text-xs font-sans font-normal text-[#4B5650]"> / night est.</span>
                  </p>
                  <p className="text-xs text-[#4B5650]">2 guests/room · Illustrative</p>
                </div>
                <button
                  type="button"
                  onClick={() => onPlanHere(destination, discovery)}
                  className="px-3.5 py-2 text-xs font-semibold text-[#1B4B3A] border border-[#1B4B3A] hover:bg-[#1B4B3A] hover:text-[#F8F6F1] rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
                >
                  Use in Planner
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
