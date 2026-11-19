import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Loader2, MapPin } from 'lucide-react';
import { INTEREST_OPTIONS, TRAVEL_INTENT_META } from '../data/sampleCatalogue';
import { formatInr, validateTripPlanInput } from '../engine/itineraryEngine';
import {
  formatCoordinates,
  formatLocationTypeLabel,
  getCuratedSeedDestinations,
} from '../services/destinationService';
import {
  PlanValidationErrors,
  ResolvedDestination,
  TravelIntent,
  TripPlanInput,
} from '../types/roamplan';
import { DestinationSearchInput } from './DestinationSearchInput';

interface TripPlannerWizardProps {
  initialInput: TripPlanInput;
  isGenerating?: boolean;
  generatingStatus?: string | null;
  onGenerate: (input: TripPlanInput) => void;
}

export function TripPlannerWizard({
  initialInput,
  isGenerating = false,
  generatingStatus = null,
  onGenerate,
}: TripPlannerWizardProps) {
  const [selectedDestination, setSelectedDestination] = useState<ResolvedDestination | null>(
    () =>
      initialInput.destination ??
      getCuratedSeedDestinations().find((s) => s.id === initialInput.destinationId) ??
      null
  );
  const [startDate, setStartDate] = useState(initialInput.startDate);
  const [daysInput, setDaysInput] = useState(String(initialInput.days));
  const [travellersInput, setTravellersInput] = useState(String(initialInput.travellers));
  const [budgetInput, setBudgetInput] = useState(String(initialInput.budgetInr));
  const [intent, setIntent] = useState<TravelIntent>(initialInput.intent);
  const [interests, setInterests] = useState<string[]>(initialInput.interests);
  const [errors, setErrors] = useState<PlanValidationErrors>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (initialInput.destination) {
      setSelectedDestination(initialInput.destination);
    }
    setIntent(initialInput.intent);
  }, [initialInput.destination, initialInput.intent]);

  const toggleInterest = (tag: string) => {
    setInterests((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    );
  };

  const buildPayload = (): TripPlanInput => ({
    destinationId: selectedDestination?.id ?? '',
    destination: selectedDestination ?? undefined,
    startDate,
    days: Number(daysInput),
    travellers: Number(travellersInput),
    budgetInr: Number(budgetInput),
    intent,
    interests,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    const payload = buildPayload();
    const validationErrors = validateTripPlanInput(payload);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length === 0) {
      onGenerate(payload);
    }
  };

  const parsedBudget = Number(budgetInput);
  const parsedDays = Number(daysInput);
  const parsedTravellers = Number(travellersInput);
  const errorCount = Object.keys(errors).length;

  return (
    <div className="max-w-[1040px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
      <div className="max-w-2xl">
        <p className="text-xs font-medium text-[#4B5650]">
          Pan-India Trip Planner · Dynamic Curation Engine
        </p>
        <h1 className="mt-2 font-editorial text-4xl sm:text-[42px] leading-[1.1] text-[#17211C]">
          Design your Indian itinerary
        </h1>
        <p className="mt-3 text-[15px] sm:text-base leading-relaxed text-[#4B5650]">
          Search any city, town, village, valley, beach, or hill station in India. RoamPlan
          discovers nearby OpenStreetMap landmarks and curates Budget, Experience, and Luxury plans
          tailored to your travel intent.
        </p>
      </div>

      {hasAttemptedSubmit && errorCount > 0 && (
        <div
          role="alert"
          className="mt-6 p-4 bg-[#FDF4F2] border border-[#E5B9B0] rounded-lg flex items-start gap-3 text-sm text-[#7D2617]"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              Please fix {errorCount} validation {errorCount === 1 ? 'issue' : 'issues'} before
              generating itineraries.
            </p>
            <ul className="mt-1 list-disc list-inside text-xs space-y-0.5">
              {Object.values(errors).map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-8">
        {/* Step 1: Pan-India Destination, Dates & Constraints */}
        <section className="bg-white border border-[#DFD9CE] rounded-lg p-6 sm:p-8">
          <p className="text-xs font-medium text-[#4B5650]">01. Destination, Duration & Budget</p>
          <h2 className="mt-1.5 font-editorial text-2xl sm:text-3xl text-[#17211C]">
            Where in India and how long are you travelling?
          </h2>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="sm:col-span-2">
              <label
                htmlFor="wizard-destination-search"
                className="block text-sm font-semibold text-[#17211C] mb-2"
              >
                Primary Indian Destination
              </label>
              <DestinationSearchInput
                id="wizard-destination-search"
                selectedDestination={selectedDestination}
                onSelect={(dest) => {
                  setSelectedDestination(dest);
                  setErrors((prev) => ({ ...prev, destinationId: undefined }));
                }}
                onClear={() => setSelectedDestination(null)}
              />

              {errors.destinationId ? (
                <p className="mt-2 text-xs font-medium text-[#9B2C1B]">{errors.destinationId}</p>
              ) : selectedDestination ? (
                <div className="mt-3 p-4 bg-[#F8F6F1] border border-[#DFD9CE] rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-[#1B4B3A] shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-[#17211C]">
                        {selectedDestination.displayLabel}
                      </p>
                      <p className="text-xs text-[#4B5650] mt-0.5">
                        {formatLocationTypeLabel(selectedDestination.locationType)} ·{' '}
                        {selectedDestination.geographicRegion}
                        {selectedDestination.district ? ` · ${selectedDestination.district}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-xs text-[#4B5650] whitespace-nowrap shrink-0">
                    {formatCoordinates(
                      selectedDestination.coordinates.lat,
                      selectedDestination.coordinates.lng
                    )}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-xs text-[#4B5650]">
                  Search across all 28 Indian states & 8 union territories (e.g., Dehradun,
                  Dharamshala, Gokarna, Manali, Udaipur, Hampi, Shillong, Ziro).
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="wizard-start-date"
                className="block text-sm font-semibold text-[#17211C] mb-2"
              >
                Start Date
              </label>
              <input
                id="wizard-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2.5 text-[15px] bg-white border border-[#CFC8BA] rounded-md text-[#17211C] focus:outline-none focus:border-[#1B4B3A] min-h-[46px]"
              />
              {errors.startDate && (
                <p className="mt-1.5 text-xs font-medium text-[#9B2C1B]">{errors.startDate}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="wizard-days"
                className="block text-sm font-semibold text-[#17211C] mb-2"
              >
                Number of Days (1–14)
              </label>
              <input
                id="wizard-days"
                type="number"
                min={1}
                max={14}
                step={1}
                value={daysInput}
                onChange={(e) => setDaysInput(e.target.value)}
                className="w-full px-3.5 py-2.5 text-[15px] font-mono tabular-nums bg-white border border-[#CFC8BA] rounded-md text-[#17211C] focus:outline-none focus:border-[#1B4B3A] min-h-[46px]"
              />
              {errors.days ? (
                <p className="mt-1.5 text-xs font-medium text-[#9B2C1B]">{errors.days}</p>
              ) : (
                <p className="mt-1.5 text-xs text-[#4B5650]">
                  Includes {parsedDays > 1 ? `${parsedDays - 1} nights` : '1 night'} accommodation
                  allowance. Trips of 3+ days support nearby multi-stop routing.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="wizard-travellers"
                className="block text-sm font-semibold text-[#17211C] mb-2"
              >
                Travellers (1–12)
              </label>
              <input
                id="wizard-travellers"
                type="number"
                min={1}
                max={12}
                step={1}
                value={travellersInput}
                onChange={(e) => setTravellersInput(e.target.value)}
                className="w-full px-3.5 py-2.5 text-[15px] font-mono tabular-nums bg-white border border-[#CFC8BA] rounded-md text-[#17211C] focus:outline-none focus:border-[#1B4B3A] min-h-[46px]"
              />
              {errors.travellers ? (
                <p className="mt-1.5 text-xs font-medium text-[#9B2C1B]">{errors.travellers}</p>
              ) : (
                <p className="mt-1.5 text-xs text-[#4B5650]">
                  Room counts calculate automatically at 2 guests per room.
                </p>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <label
                  htmlFor="wizard-budget"
                  className="text-sm font-semibold text-[#17211C]"
                >
                  Total Trip Budget (INR)
                </label>
                {Number.isFinite(parsedBudget) && parsedBudget > 0 && parsedTravellers > 0 && (
                  <span className="text-xs font-mono tabular-nums text-[#4B5650]">
                    ≈ {formatInr(parsedBudget / parsedTravellers)} / person
                  </span>
                )}
              </div>
              <input
                id="wizard-budget"
                type="number"
                min={1500}
                max={5000000}
                step={500}
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full px-3.5 py-2.5 text-[15px] font-mono tabular-nums bg-white border border-[#CFC8BA] rounded-md text-[#17211C] focus:outline-none focus:border-[#1B4B3A] min-h-[46px]"
              />
              {errors.budgetInr ? (
                <p className="mt-1.5 text-xs font-medium text-[#9B2C1B]">{errors.budgetInr}</p>
              ) : (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[#4B5650]">Presets:</span>
                  {[15000, 30000, 50000, 95000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBudgetInput(String(preset))}
                      className={`px-2.5 py-1.5 rounded border font-mono tabular-nums transition-colors min-h-[32px] ${
                        Number(budgetInput) === preset
                          ? 'border-[#1B4B3A] bg-[#1B4B3A] text-[#F8F6F1]'
                          : 'border-[#CFC8BA] text-[#4B5650] hover:border-[#17211C] hover:text-[#17211C]'
                      }`}
                    >
                      {formatInr(preset)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Step 2: Travel Intent */}
        <section className="bg-white border border-[#DFD9CE] rounded-lg p-6 sm:p-8">
          <p className="text-xs font-medium text-[#4B5650]">02. Travel Intent</p>
          <h2 className="mt-1.5 font-editorial text-2xl sm:text-3xl text-[#17211C]">
            What kind of journey are you planning?
          </h2>
          <p className="mt-1.5 text-sm text-[#4B5650]">
            Your intent drives which OpenStreetMap landmarks get prioritized, how days are paced,
            and whether multi-stop transfers or outdoor safety advisories are scheduled.
          </p>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.keys(TRAVEL_INTENT_META) as TravelIntent[]).map((intentKey) => {
              const meta = TRAVEL_INTENT_META[intentKey];
              const isSelected = intent === intentKey;
              return (
                <button
                  key={intentKey}
                  type="button"
                  onClick={() => setIntent(intentKey)}
                  aria-pressed={isSelected}
                  className={`text-left p-5 rounded-md border transition-colors flex flex-col justify-between ${
                    isSelected
                      ? 'border-[#1B4B3A] bg-[#F2F6F4]'
                      : 'border-[#DFD9CE] bg-white hover:border-[#B2A99A]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-editorial text-xl text-[#17211C]">{meta.label}</span>
                      {isSelected && (
                        <Check className="w-4 h-4 text-[#1B4B3A] shrink-0" aria-hidden="true" />
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#4B5650]">
                      {meta.shortDescription}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-5 pt-4 border-t border-[#EFECE4] text-sm leading-relaxed text-[#4B5650]">
            <strong className="font-semibold text-[#17211C]">
              {TRAVEL_INTENT_META[intent].label} curation rule:
            </strong>{' '}
            {TRAVEL_INTENT_META[intent].planningBehavior}
          </p>
        </section>

        {/* Step 3: Interests */}
        <section className="bg-white border border-[#DFD9CE] rounded-lg p-6 sm:p-8">
          <p className="text-xs font-medium text-[#4B5650]">03. Optional Interests</p>
          <h2 className="mt-1.5 font-editorial text-2xl sm:text-3xl text-[#17211C]">
            Highlight experiences you care about most
          </h2>

          <div className="mt-5 flex flex-wrap gap-2.5">
            {INTEREST_OPTIONS.map((tag) => {
              const selected = interests.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleInterest(tag)}
                  aria-pressed={selected}
                  className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors min-h-[42px] ${
                    selected
                      ? 'bg-[#1B4B3A] text-[#F8F6F1] border-[#1B4B3A]'
                      : 'bg-white text-[#4B5650] border-[#CFC8BA] hover:border-[#17211C] hover:text-[#17211C]'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>

        {/* Submit Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          <p className="text-sm text-[#4B5650] max-w-lg">
            Discovers real nearby OpenStreetMap landmarks and generates Budget, Experience, and
            Luxury alternatives with itemized estimated costs.
          </p>
          <button
            type="submit"
            disabled={isGenerating}
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-70 rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[48px]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{generatingStatus ?? 'Discovering landmarks & curating plans…'}</span>
              </>
            ) : (
              <>
                <span>Generate 3 Curated Options</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
