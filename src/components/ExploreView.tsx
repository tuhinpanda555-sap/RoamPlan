import { useMemo, useState } from 'react';
import { ArrowRight, Compass, Loader2 } from 'lucide-react';
import {
  ACCOMMODATIONS,
  DESTINATIONS,
  EXPERIENCES,
  TRAVEL_INTENT_META,
} from '../data/sampleCatalogue';
import { formatInr } from '../engine/itineraryEngine';
import {
  PAN_INDIA_QUICK_PROMPTS,
  formatCoordinates,
  getCuratedSeedDestinations,
  resolveDestinationByName,
} from '../services/destinationService';
import { Destination, ResolvedDestination, TravelIntent } from '../types/roamplan';
import { DestinationSearchInput } from './DestinationSearchInput';
import { EditorialImage } from './EditorialImage';

interface ExploreViewProps {
  onSelectDestination: (destination: ResolvedDestination) => void;
  onStartPlanning: (presetDestination?: ResolvedDestination, presetIntent?: TravelIntent) => void;
  onOpenAbout: () => void;
}

export function ExploreView({
  onSelectDestination,
  onStartPlanning,
  onOpenAbout,
}: ExploreViewProps) {
  const [heroDestination, setHeroDestination] = useState<ResolvedDestination | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<TravelIntent | 'all'>('all');
  const [resolvingQuickPrompt, setResolvingQuickPrompt] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  const curatedSeeds = useMemo(() => getCuratedSeedDestinations(), []);

  const filteredExamples = useMemo(() => {
    return DESTINATIONS.filter((dest) => {
      if (!dest.published) return false;
      return selectedIntent === 'all' || dest.supportedIntents.includes(selectedIntent);
    });
  }, [selectedIntent]);

  const getMinNightlyFor = (destId: string): number => {
    const stays = ACCOMMODATIONS.filter((a) => a.destinationId === destId);
    if (stays.length === 0) return 0;
    return Math.min(...stays.map((s) => s.estimatedNightlyInr));
  };

  const getExperienceCountFor = (destId: string): number =>
    EXPERIENCES.filter((e) => e.destinationId === destId && e.category !== 'transfer').length;

  const intents: Array<{ key: TravelIntent | 'all'; label: string }> = [
    { key: 'all', label: 'All Intents' },
    { key: 'rest', label: 'Rest' },
    { key: 'enjoy', label: 'Enjoy' },
    { key: 'travel', label: 'Travel' },
    { key: 'trek', label: 'Trek' },
    { key: 'adventure', label: 'Adventure' },
  ];

  const handleQuickPromptClick = async (query: string) => {
    setQuickError(null);
    setResolvingQuickPrompt(query);
    try {
      const resolved = await resolveDestinationByName(query);
      if (resolved) {
        onSelectDestination(resolved);
      } else {
        setQuickError(`Unable to resolve ${query} right now. Try searching directly in the bar above.`);
      }
    } finally {
      setResolvingQuickPrompt(null);
    }
  };

  const toResolvedSeed = (dest: Destination): ResolvedDestination => {
    const match = curatedSeeds.find((s) => s.id === dest.id);
    if (match) return match;
    return {
      id: dest.id,
      name: dest.name,
      state: 'Himachal Pradesh',
      district: dest.region,
      country: 'India',
      coordinates: { lat: 32.2432, lng: 77.1892 },
      locationType: 'hill_station',
      geographicRegion: 'North India (Himalayas)',
      displayLabel: `${dest.name}, Himachal Pradesh`,
      summary: dest.summary,
      source: 'curated_seed',
      curatedSeedId: dest.id,
      imageUrl: dest.imageUrl,
      imageAlt: dest.imageAlt,
      imageCaption: dest.imageCaption,
      elevationMeters: dest.elevationMeters,
    };
  };

  return (
    <div className="pb-24">
      {/* Editorial Hero Section */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-1">
            <div>
              <p className="text-sm font-medium text-[#4B5650]">
                Pan-India Travel Planner · OpenStreetMap Discovery
              </p>
              <h1 className="mt-4 font-editorial text-4xl sm:text-5xl lg:text-[54px] leading-[1.08] tracking-tight text-[#17211C]">
                Plan Indian journeys by travel intent and honest budget.
              </h1>
              <p className="mt-5 text-base leading-relaxed text-[#4B5650] max-w-xl">
                Search any city, town, village, valley, hill station, or coastal getaway across all
                28 Indian states and 8 union territories. Discover nearby landmarks, compare Budget,
                Experience, and Luxury plans, and save trips privately to Cloud Firestore.
              </p>
            </div>

            <div className="mt-8 space-y-5">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label htmlFor="hero-destination-search" className="sr-only">
                    Search any destination across India
                  </label>
                  <DestinationSearchInput
                    id="hero-destination-search"
                    selectedDestination={heroDestination}
                    placeholder="Search Dehradun, Gokarna, Dharamshala, Udaipur, Ziro…"
                    onSelect={(dest) => {
                      setHeroDestination(dest);
                      onSelectDestination(dest);
                    }}
                    onClear={() => setHeroDestination(null)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onStartPlanning(heroDestination ?? undefined)}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[48px]"
                >
                  <span>Start Planning</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/* Quick Pan-India Discovery Shortcuts */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#4B5650]">
                  Try dynamic India-wide discovery:
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {PAN_INDIA_QUICK_PROMPTS.slice(0, 6).map((item) => {
                    const busy = resolvingQuickPrompt === item.query;
                    return (
                      <button
                        key={item.query}
                        type="button"
                        disabled={Boolean(resolvingQuickPrompt)}
                        onClick={() => void handleQuickPromptClick(item.query)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#17211C] bg-white border border-[#DFD9CE] hover:border-[#1B4B3A] hover:text-[#1B4B3A] rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[36px] disabled:opacity-60"
                      >
                        {busy && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                        <span>{item.label}</span>
                        <span className="text-[#4B5650] font-normal">· {item.state}</span>
                      </button>
                    );
                  })}
                </div>
                {quickError && <p className="text-xs text-[#8A2F21]">{quickError}</p>}
              </div>

              <p className="text-xs leading-relaxed text-[#4B5650]">
                Transparency notice: Location names and coordinates come from OpenStreetMap;
                accommodation categories and INR budgets are illustrative planning estimates—never
                live availability or confirmed bookings.{' '}
                <button
                  type="button"
                  onClick={onOpenAbout}
                  className="font-medium underline underline-offset-2 text-[#17211C] hover:text-[#1B4B3A]"
                >
                  How it works
                </button>
              </p>
            </div>
          </div>

          <div className="lg:col-span-6">
            <figure className="h-full flex flex-col">
              <div className="relative overflow-hidden rounded-lg border border-[#DFD9CE] bg-[#E7E3D9] aspect-[16/11] lg:aspect-auto lg:flex-1 lg:min-h-[460px]">
                <EditorialImage
                  src="/src/assets/images/hero_manali_valley_1795084286189.jpg"
                  alt="Deodar cedar forest and traditional stone-and-timber lodge overlooking snow peaks in the Indian Himalayas"
                  title="India Regional Atlas"
                  className="w-full h-full object-cover"
                />
              </div>
              <figcaption className="mt-3 flex items-center justify-between gap-4 text-xs text-[#4B5650]">
                <span className="italic font-editorial text-sm">
                  Fig. 01 — Upper Kullu cedar slopes, one of thousands of Indian destinations searchable in RoamPlan.
                </span>
                <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                  32.2432° N, 77.1892° E
                </span>
              </figcaption>
            </figure>
          </div>
        </div>

        {/* Full-width operational summary strip below the 2-column hero split */}
        <div className="mt-12 pt-7 border-t border-[#DFD9CE] grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-xs font-medium text-[#4B5650]">Geographic Coverage</p>
            <p className="mt-1.5 font-mono tabular-nums text-lg font-medium text-[#17211C]">
              28 States · 8 UTs
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#4B5650]">Location Intelligence</p>
            <p className="mt-1.5 text-sm font-semibold text-[#17211C]">
              OpenStreetMap Geocoding & POIs
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#4B5650]">Travel Intents</p>
            <p className="mt-1.5 text-sm font-semibold text-[#17211C]">
              Rest · Enjoy · Travel · Trek · Adventure
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#4B5650]">Planning Honesty</p>
            <p className="mt-1.5 text-sm font-semibold text-[#17211C]">
              Estimated budgets · No fake bookings
            </p>
          </div>
        </div>
      </section>

      {/* Curated Example Seed Destinations (Explicitly examples, never a search limit) */}
      <section
        id="catalogue-section"
        className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-14 border-t border-[#DFD9CE]"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-[#4B5650]">
              01. Curated Example Monographs (Search Any Indian Destination Above)
            </p>
            <h2 className="mt-2 font-editorial text-3xl sm:text-4xl text-[#17211C]">
              Featured Himalayan examples to inspire your itinerary
            </h2>
          </div>

          {/* Interactive Intent Filter Bar */}
          <div
            role="group"
            aria-label="Filter example destinations by travel intent"
            className="flex flex-wrap items-center gap-1.5 p-1 bg-[#EFECE4] rounded-md"
          >
            {intents.map((item) => {
              const active = selectedIntent === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedIntent(item.key)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                    active
                      ? 'bg-white text-[#17211C] shadow-xs'
                      : 'text-[#4B5650] hover:text-[#17211C]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {filteredExamples.length === 0 ? (
          <div className="mt-10 p-10 bg-white border border-[#DFD9CE] rounded-lg text-center">
            <Compass className="w-7 h-7 mx-auto text-[#4B5650]" strokeWidth={1.5} aria-hidden="true" />
            <h3 className="mt-3 font-editorial text-2xl text-[#17211C]">
              No example destinations matched this intent filter
            </h3>
            <p className="mt-2 text-sm text-[#4B5650] max-w-md mx-auto">
              Reset the filter or use the pan-India search bar above to discover any Indian city,
              hill station, beach, or village.
            </p>
            <button
              type="button"
              onClick={() => setSelectedIntent('all')}
              className="mt-5 px-5 py-2.5 text-sm font-semibold text-[#17211C] border border-[#CFC8BA] hover:bg-[#EFECE4] rounded-md transition-colors min-h-[44px]"
            >
              Show All Examples
            </button>
          </div>
        ) : (
          <div className="mt-9 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredExamples.map((dest: Destination) => {
              const resolved = toResolvedSeed(dest);
              const minStay = getMinNightlyFor(dest.id);
              const expCount = getExperienceCountFor(dest.id);
              return (
                <article
                  key={dest.id}
                  className="group bg-white border border-[#DFD9CE] rounded-lg overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => onSelectDestination(resolved)}
                    className="block text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#1B4B3A]"
                  >
                    <div className="aspect-[16/11] overflow-hidden bg-[#E7E3D9]">
                      <EditorialImage
                        src={dest.imageUrl}
                        alt={dest.imageAlt}
                        title={dest.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    </div>
                  </button>

                  <div className="p-6 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-mono tabular-nums text-[#4B5650]">
                        {resolved.state} · {formatCoordinates(resolved.coordinates.lat, resolved.coordinates.lng)}
                      </p>
                      <h3 className="mt-2 font-editorial text-2xl sm:text-[26px] leading-snug text-[#17211C]">
                        <button
                          type="button"
                          onClick={() => onSelectDestination(resolved)}
                          className="text-left hover:text-[#1B4B3A] transition-colors"
                        >
                          {dest.name}
                        </button>
                      </h3>
                      <p className="mt-2.5 text-[15px] leading-relaxed text-[#4B5650]">
                        {dest.summary}
                      </p>
                      <p className="mt-3.5 text-xs text-[#4B5650]">
                        Suited for:{' '}
                        <span className="font-medium text-[#17211C]">
                          {dest.supportedIntents
                            .map((i) => TRAVEL_INTENT_META[i].label)
                            .join(' · ')}
                        </span>
                      </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-[#EFECE4] flex items-center justify-between gap-3">
                      <div className="text-xs text-[#4B5650]">
                        <span className="font-mono tabular-nums text-[#17211C] font-medium">
                          Est. {formatInr(minStay)}/night
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>{expCount} examples</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => onSelectDestination(resolved)}
                          className="text-sm font-semibold text-[#1B4B3A] hover:text-[#13382B] whitespace-nowrap shrink-0"
                        >
                          Explore
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onStartPlanning(
                              resolved,
                              selectedIntent === 'all' ? undefined : selectedIntent
                            )
                          }
                          className="text-sm font-semibold text-[#17211C] hover:text-[#1B4B3A] underline underline-offset-4 whitespace-nowrap shrink-0"
                        >
                          Plan
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Travel Intents Editorial Section */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-14 border-t border-[#DFD9CE]">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-[#4B5650]">02. Five Travel Intents</p>
          <h2 className="mt-2 font-editorial text-3xl sm:text-4xl text-[#17211C]">
            Every itinerary curates experiences around your travel intent
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#4B5650]">
            Instead of dumping an unfiltered list of nearby pins, RoamPlan scores and sequences
            discovered landmarks, multi-stop routes, pacing, and safety guidance around how you want
            to travel.
          </p>
        </div>

        <div className="mt-9 divide-y divide-[#DFD9CE] border-y border-[#DFD9CE]">
          {(Object.keys(TRAVEL_INTENT_META) as TravelIntent[]).map((intentKey, index) => {
            const meta = TRAVEL_INTENT_META[intentKey];
            return (
              <div
                key={intentKey}
                className="py-6 grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 items-baseline"
              >
                <div className="md:col-span-3 flex items-baseline gap-3">
                  <span className="font-mono text-xs text-[#4B5650] tabular-nums">
                    0{index + 1}
                  </span>
                  <h3 className="font-editorial text-2xl text-[#17211C]">{meta.label}</h3>
                </div>
                <p className="md:col-span-6 text-[15px] leading-relaxed text-[#4B5650]">
                  {meta.planningBehavior}
                </p>
                <div className="md:col-span-3 md:text-right">
                  <button
                    type="button"
                    onClick={() => onStartPlanning(heroDestination ?? undefined, intentKey)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1B4B3A] hover:text-[#13382B] whitespace-nowrap shrink-0"
                  >
                    <span>Plan a {meta.label} trip</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
