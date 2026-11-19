import { ArrowRight, Compass, ShieldCheck } from 'lucide-react';
import { SAMPLE_PROVENANCE, UNCONFIRMED_ENQUIRY_NOTICE } from '../data/sampleCatalogue';

interface AboutDisclosureViewProps {
  onStartPlanning: () => void;
}

export function AboutDisclosureView({ onStartPlanning }: AboutDisclosureViewProps) {
  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
      <p className="text-xs font-medium text-[#4B5650]">
        About RoamPlan · Pan-India Travel Planning Architecture
      </p>
      <h1 className="mt-2 font-editorial text-3xl sm:text-4xl text-[#17211C]">
        How RoamPlan works & data-source transparency
      </h1>
      <p className="mt-4 text-base leading-relaxed text-[#4B5650]">
        RoamPlan is a pan-India travel itinerary planner covering all 28 Indian states and 8 union
        territories. It combines OpenStreetMap-based destination geocoding and geospatial landmark
        discovery with a curated, budget-aware itinerary engine, Google Sign-In, and private Cloud
        Firestore trip persistence—without paid travel APIs or fabricated bookings.
      </p>

      <div className="mt-10 space-y-10 divide-y divide-[#DFD9CE]">
        <section className="pt-2">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-[#1B4B3A]" aria-hidden="true" />
            <h2 className="font-editorial text-2xl text-[#17211C]">
              01. Pan-India OpenStreetMap Discovery & Usage Policy
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#4B5650]">
            Any Indian city, town, village, hill station, beach destination, valley, or heritage
            region can be searched dynamically. RoamPlan resolves destinations into their canonical{' '}
            <strong>name</strong>, <strong>state or union territory</strong>,{' '}
            <strong>geographic coordinates</strong>, <strong>location type</strong>, and{' '}
            <strong>Indian geographic region</strong>.
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-[#4B5650] list-disc list-inside leading-relaxed">
            <li>
              <strong>Geocoding:</strong> Uses OpenStreetMap Nominatim (filtered to India via{' '}
              <span className="font-mono">countrycodes=in</span>, throttled to ≤1 request/second
              with input debouncing) with Komoot Photon as an India-bounded fallback.
            </li>
            <li>
              <strong>Nearby Geospatial Discovery:</strong> Queries the OpenStreetMap Overpass API
              around the resolved coordinates for tourist attractions, natural landmarks, viewpoints,
              lakes &amp; waterfalls, cultural &amp; heritage sites, adventure spots, local areas,
              and nearby towns (12–55 km) for multi-stop journeys.
            </li>
            <li>
              <strong>Caching &amp; Honest Fallbacks:</strong> Search and geospatial responses are
              cached for 24 hours in memory and browser storage to stay respectful of public
              OpenStreetMap usage policies. When OpenStreetMap coverage is sparse for remote places,
              RoamPlan generates a truthful partial itinerary clearly distinguishing{' '}
              <strong>Verified OSM Locations</strong> from{' '}
              <strong>Estimated Planning Guidance</strong>—never inventing fictional landmarks.
            </li>
          </ul>
        </section>

        <section className="pt-8">
          <h2 className="font-editorial text-2xl text-[#17211C]">
            02. Curated 4-Category Budget Engine
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#4B5650]">
            Rather than returning an unfiltered list of nearby places, RoamPlan scores discovered
            locations against your travel intent (<strong>Rest</strong>, <strong>Enjoy</strong>,{' '}
            <strong>Travel</strong>, <strong>Trek</strong>, or <strong>Adventure</strong>), chosen
            interests, category variety, and geographic distance.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[#4B5650]">
            Every run produces three side-by-side alternatives—<strong>Budget</strong>,{' '}
            <strong>Experience</strong>, and <strong>Luxury</strong>—broken down into four exact
            cost categories: <strong>Accommodation</strong>, <strong>Transportation</strong>,{' '}
            <strong>Activities &amp; Landmarks</strong>, and <strong>Food</strong>. Replacing,
            adding, or removing any item recalculates the Estimated Total Cost automatically.
          </p>
        </section>

        <section className="pt-8">
          <h2 className="font-editorial text-2xl text-[#17211C]">
            03. Accommodation Guidance & Booking Transparency
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#4B5650]">{SAMPLE_PROVENANCE}</p>
          <div className="mt-4 p-4 bg-[#FBF7F0] border border-[#E6D6BC] rounded-md text-xs text-[#6B3F10] font-medium leading-relaxed">
            {UNCONFIRMED_ENQUIRY_NOTICE}
          </div>
          <ul className="mt-4 space-y-2 text-sm text-[#4B5650] list-disc list-inside leading-relaxed">
            <li>
              Accommodation lines represent contextual Budget, Experience, and Luxury nightly
              planning bands calibrated to regional Indian pricing—never fabricated hotel names,
              live room inventory, or fake guest reviews.
            </li>
            <li>
              Verified partner hotels, homestays, and live availability are planned for a future
              marketplace release.
            </li>
            <li>
              The seven featured Himachal Pradesh guides on the landing page remain available strictly
              as curated editorial examples, never as a limit on where you can plan.
            </li>
          </ul>
        </section>

        <section className="pt-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#1B4B3A]" aria-hidden="true" />
            <h2 className="font-editorial text-2xl text-[#17211C]">
              04. Google Authentication, Cloud Firestore & Owner-Only Security
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#4B5650]">
            Searching destinations and generating draft itineraries works publicly. Saving private
            itineraries or sample enquiries requires <strong>Google Sign-In</strong> via Firebase
            Authentication so your trips persist across browser refreshes and across devices.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-[#4B5650] list-disc list-inside leading-relaxed">
            <li>
              User profiles are stored under <span className="font-mono">/users/{'{uid}'}</span>,
              saved trips under{' '}
              <span className="font-mono">/users/{'{uid}'}/trips/{'{tripId}'}</span> (with day-wise
              line items in <span className="font-mono">items/</span>), and sample enquiries under{' '}
              <span className="font-mono">/users/{'{uid}'}/bookingRequests/{'{requestId}'}</span>.
            </li>
            <li>
              Firestore Security Rules enforce owner-only access (
              <span className="font-mono">request.auth.uid == uid</span>) with schema validation,
              immutable audit timestamps, and default-deny on unmatched paths. No private keys or
              paid API credentials are exposed in frontend code.
            </li>
            <li>
              Existing browser <span className="font-mono">localStorage</span> trips are detected
              automatically after sign-in and offered for one-click deduplicated migration to Cloud
              Firestore.
            </li>
          </ul>

          <div className="mt-7">
            <button
              type="button"
              onClick={onStartPlanning}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md transition-colors min-h-[46px]"
            >
              <span>Open India Trip Planner</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
