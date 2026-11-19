import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { TRAVEL_INTENT_META } from '../data/sampleCatalogue';
import { formatInr } from '../engine/itineraryEngine';
import { formatCoordinates } from '../services/destinationService';
import { GeneratedItineraryOption, TripPlanInput } from '../types/roamplan';

interface ItineraryComparisonViewProps {
  input: TripPlanInput;
  options: GeneratedItineraryOption[];
  onBackToWizard: () => void;
  onSelectOption: (option: GeneratedItineraryOption) => void;
}

export function ItineraryComparisonView({
  input,
  options,
  onBackToWizard,
  onSelectOption,
}: ItineraryComparisonViewProps) {
  const anyWithinBudget = options.some((o) => o.withinBudget);
  const primary = options[0];

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24">
      <button
        type="button"
        onClick={onBackToWizard}
        className="inline-flex items-center gap-2 text-sm font-medium text-[#4B5650] hover:text-[#17211C]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Adjust Trip Inputs</span>
      </button>

      <div className="mt-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-[#DFD9CE]">
        <div>
          <p className="text-xs font-medium text-[#4B5650]">
            Budget Comparison · {TRAVEL_INTENT_META[input.intent].label} Intent · Start{' '}
            <span className="font-mono tabular-nums">{input.startDate}</span>
            {primary?.coordinates && (
              <>
                {' '}
                ·{' '}
                <span className="font-mono tabular-nums">
                  {formatCoordinates(primary.coordinates.lat, primary.coordinates.lng)}
                </span>
              </>
            )}
          </p>
          <h1 className="mt-2 font-editorial text-3xl sm:text-4xl text-[#17211C]">
            Budget, Experience & Luxury plans for {primary?.destinationName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#4B5650] font-mono tabular-nums">
          <span>
            {input.days} {input.days === 1 ? 'day' : 'days'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {input.travellers} {input.travellers === 1 ? 'traveller' : 'travellers'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-[#17211C] font-medium">Budget: {formatInr(input.budgetInr)}</span>
        </div>
      </div>

      {/* Discovery Source / Fallback Transparency Notice */}
      {primary?.discoveryNotice && (
        <div
          role="status"
          className={`mt-6 p-4 rounded-lg border flex items-start gap-3 text-sm ${
            primary.discoveryStatus === 'verified'
              ? 'bg-[#F1F6F3] border-[#CFE0D8] text-[#174233]'
              : 'bg-[#FBF7F0] border-[#E6D6BC] text-[#6B3F10]'
          }`}
        >
          {primary.discoveryStatus === 'verified' ? (
            <Info className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
          )}
          <p className="leading-relaxed">{primary.discoveryNotice}</p>
        </div>
      )}

      {/* Explicit notice if NONE of the three styles fit within budget */}
      {!anyWithinBudget && (
        <div
          role="status"
          className="mt-6 p-5 bg-[#FBF7F0] border border-[#E6D6BC] rounded-lg flex items-start gap-3 text-sm text-[#6B3F10]"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              None of the three estimated plans fit inside {formatInr(input.budgetInr)} for{' '}
              {input.days} {input.days === 1 ? 'day' : 'days'} and {input.travellers}{' '}
              {input.travellers === 1 ? 'traveller' : 'travellers'}.
            </p>
            <p className="mt-1 text-sm leading-relaxed">
              We display exact itemized estimates across accommodation, transportation, activities,
              and food rather than hiding costs. Open any plan in the editor to adjust stays or
              activities, or revise your duration and budget.
            </p>
          </div>
        </div>
      )}

      {/* Route & pacing explanation */}
      {primary?.intentSummaryNote && (
        <p className="mt-6 text-sm leading-relaxed text-[#4B5650] max-w-3xl">
          <strong className="font-semibold text-[#17211C]">Curation summary:</strong>{' '}
          {primary.intentSummaryNote}
        </p>
      )}

      {/* Side-by-side 3-tier comparison */}
      <div className="mt-7 grid grid-cols-1 lg:grid-cols-3 gap-7 items-stretch">
        {options.map((option) => {
          const { costBreakdown } = option;
          const stayNames = Array.from(
            new Set(option.items.filter((i) => i.itemType === 'accommodation').map((i) => i.title))
          );

          return (
            <article
              key={option.style}
              className={`bg-white rounded-lg border p-6 sm:p-7 flex flex-col justify-between ${
                option.style === 'experience_seeker' ? 'border-[#1B4B3A]' : 'border-[#DFD9CE]'
              }`}
            >
              <div>
                <p className="text-xs font-medium text-[#4B5650]">{option.stopNames.join(' → ')}</p>
                <h2 className="mt-1.5 font-editorial text-3xl text-[#17211C]">
                  {option.styleLabel}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#4B5650]">
                  {option.styleSummary}
                </p>

                {/* Total Price Block */}
                <div className="mt-5 pt-4 border-t border-[#EFECE4]">
                  <p className="text-xs font-medium text-[#4B5650]">Estimated Total Cost</p>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <p className="font-mono tabular-nums text-2xl font-medium text-[#17211C]">
                      {formatInr(option.estimatedTotalInr)}
                    </p>
                    <p className="font-mono tabular-nums text-xs text-[#4B5650]">
                      {formatInr(option.perPersonEstimateInr)}/person
                    </p>
                  </div>

                  {/* Explicit Budget Fit Status */}
                  <div
                    className={`mt-3.5 p-3.5 rounded-md text-xs flex items-start gap-2 ${
                      option.withinBudget
                        ? 'bg-[#F1F6F3] text-[#174233] border border-[#CFE0D8]'
                        : 'bg-[#FBF7F0] text-[#7A440E] border border-[#E6D6BC]'
                    }`}
                  >
                    {option.withinBudget ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    )}
                    <p className="leading-relaxed">{option.budgetExplanation}</p>
                  </div>
                </div>

                {/* Mandatory 4-Category Cost Breakdown */}
                <dl className="mt-5 pt-4 border-t border-[#EFECE4] space-y-2.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#4B5650]">Accommodation (est.)</dt>
                    <dd className="font-mono tabular-nums text-[#17211C]">
                      {formatInr(costBreakdown.accommodationInr)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#4B5650]">Transportation</dt>
                    <dd className="font-mono tabular-nums text-[#17211C]">
                      {formatInr(costBreakdown.transportationInr)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#4B5650]">Activities & Sightseeing</dt>
                    <dd className="font-mono tabular-nums text-[#17211C]">
                      {formatInr(costBreakdown.activitiesInr)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#4B5650]">Food Allowance</dt>
                    <dd className="font-mono tabular-nums text-[#17211C]">
                      {formatInr(costBreakdown.foodInr)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 pt-2.5 border-t border-[#EFECE4] font-semibold">
                    <dt className="text-[#17211C]">Estimated Total</dt>
                    <dd className="font-mono tabular-nums text-[#17211C]">
                      {formatInr(costBreakdown.totalInr)}
                    </dd>
                  </div>
                </dl>

                {/* Highlight Stays & Day Preview */}
                <div className="mt-5 pt-4 border-t border-[#EFECE4] space-y-2.5">
                  <p className="text-xs font-semibold text-[#17211C]">Contextual Stay Guidance</p>
                  <ul className="text-sm text-[#4B5650] space-y-1">
                    {stayNames.map((name) => (
                      <li key={name}>· {name}</li>
                    ))}
                  </ul>

                  <p className="pt-2 text-xs font-semibold text-[#17211C]">Curated Stops</p>
                  <ul className="text-sm text-[#4B5650] space-y-1">
                    {option.items
                      .filter((i) => i.itemType === 'activity')
                      .slice(0, 4)
                      .map((item) => (
                        <li key={item.id}>
                          Day {item.dayNumber}: {item.title}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-[#EFECE4]">
                <button
                  type="button"
                  onClick={() => onSelectOption(option)}
                  className={`w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-md transition-colors min-h-[46px] ${
                    option.style === 'experience_seeker'
                      ? 'bg-[#1B4B3A] text-[#F8F6F1] hover:bg-[#13382B]'
                      : 'bg-[#EFECE4] text-[#17211C] hover:bg-[#E2DDD2]'
                  }`}
                >
                  <span>Open Day-Wise Itinerary & Edit</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-[#4B5650]">
        Disclosure: Mapped landmark names come from OpenStreetMap where available; accommodation
        categories, transit durations, and INR totals are illustrative planning estimates only—never
        live availability, verified hotel listings, or confirmed bookings.
      </p>
    </div>
  );
}
