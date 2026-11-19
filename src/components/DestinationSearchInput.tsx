import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Globe,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  PAN_INDIA_QUICK_PROMPTS,
  formatCoordinates,
  formatLocationTypeLabel,
  searchIndianDestinations,
} from '../services/destinationService';
import { DestinationSearchOutcome, ResolvedDestination } from '../types/roamplan';

interface DestinationSearchInputProps {
  id: string;
  selectedDestination?: ResolvedDestination | null;
  placeholder?: string;
  onSelect: (destination: ResolvedDestination) => void;
  onClear?: () => void;
  autoFocus?: boolean;
}

export function DestinationSearchInput({
  id,
  selectedDestination,
  placeholder = 'Search any city, town, hill station, beach, or valley in India (e.g., Dehradun, Gokarna, Dharamshala, Ziro)…',
  onSelect,
  onClear,
  autoFocus = false,
}: DestinationSearchInputProps) {
  const [query, setQuery] = useState(selectedDestination?.displayLabel ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [outcome, setOutcome] = useState<DestinationSearchOutcome | null>(null);
  const [searchTick, setSearchTick] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (selectedDestination) {
      setQuery(selectedDestination.displayLabel);
    }
  }, [selectedDestination?.id, selectedDestination?.displayLabel]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    // Skip re-querying if text matches currently selected destination verbatim and not explicitly triggered
    if (
      selectedDestination &&
      trimmed.toLowerCase() === selectedDestination.displayLabel.toLowerCase() &&
      searchTick === 0
    ) {
      return;
    }

    if (trimmed.length < 2) {
      setOutcome(null);
      setIsLoading(false);
      return;
    }

    const reqId = ++requestIdRef.current;
    setIsLoading(true);

    const debounceTimer = window.setTimeout(() => {
      void searchIndianDestinations(trimmed).then((result) => {
        if (requestIdRef.current !== reqId) return;
        setOutcome(result);
        setIsLoading(false);
      });
    }, 340);

    return () => window.clearTimeout(debounceTimer);
  }, [query, searchTick, selectedDestination]);

  const handleChooseDestination = (dest: ResolvedDestination) => {
    setQuery(dest.displayLabel);
    setOutcome(null);
    setIsOpen(false);
    onSelect(dest);
  };

  const handleQuickPrompt = (promptQuery: string) => {
    setQuery(promptQuery);
    setIsOpen(true);
    setSearchTick((t) => t + 1);
  };

  const handleRetry = () => {
    setSearchTick((t) => t + 1);
  };

  const showQuickPrompts = isOpen && query.trim().length < 2;
  const showResultsPanel = isOpen && (query.trim().length >= 2 || showQuickPrompts);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search
          className="w-4 h-4 text-[#4B5650] absolute left-3.5 pointer-events-none"
          aria-hidden="true"
        />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showResultsPanel}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSearchTick((t) => t + 1);
          }}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-3 text-[15px] font-normal bg-white border border-[#CFC8BA] rounded-md text-[#17211C] placeholder:text-[#6D7771] focus:outline-none focus:border-[#1B4B3A] focus:ring-2 focus:ring-[#1B4B3A]/15 min-h-[48px] transition-colors"
        />
        {isLoading ? (
          <Loader2
            className="w-4 h-4 text-[#1B4B3A] animate-spin absolute right-3.5"
            aria-label="Searching Indian destinations"
          />
        ) : query.length > 0 ? (
          <button
            type="button"
            aria-label="Clear destination search"
            onClick={() => {
              setQuery('');
              setOutcome(null);
              setIsOpen(true);
              onClear?.();
            }}
            className="w-7 h-7 flex items-center justify-center text-[#4B5650] hover:text-[#17211C] rounded absolute right-2"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {showResultsPanel && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-2 bg-white border border-[#DFD9CE] rounded-lg shadow-lg z-50 overflow-hidden max-h-[380px] overflow-y-auto"
        >
          {showQuickPrompts ? (
            <div className="p-4">
              <p className="text-xs font-medium text-[#4B5650] mb-3">
                Popular India-wide searches (or type any Indian city, village, valley, or beach)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PAN_INDIA_QUICK_PROMPTS.map((item) => (
                  <button
                    key={item.query}
                    type="button"
                    onClick={() => handleQuickPrompt(item.query)}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 text-left rounded-md border border-[#EFECE4] hover:border-[#1B4B3A] hover:bg-[#F8F6F1] transition-colors"
                  >
                    <span className="text-sm font-medium text-[#17211C]">
                      {item.label}, <span className="text-[#4B5650] font-normal">{item.state}</span>
                    </span>
                    <span className="text-xs text-[#4B5650] whitespace-nowrap shrink-0">
                      {item.typeHint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : isLoading ? (
            <div className="p-5 flex items-center gap-3 text-sm text-[#4B5650]">
              <Loader2 className="w-4 h-4 text-[#1B4B3A] animate-spin shrink-0" aria-hidden="true" />
              <span>Searching OpenStreetMap across Indian states & union territories…</span>
            </div>
          ) : outcome?.status === 'ok' && outcome.results.length > 0 ? (
            <div>
              {outcome.message && (
                <div className="px-4 py-2.5 bg-[#FBF7F0] border-b border-[#E6D6BC] text-xs text-[#6B3F10]">
                  {outcome.message}
                </div>
              )}
              <ul className="divide-y divide-[#EFECE4]">
                {outcome.results.map((dest) => (
                  <li key={`${dest.id}-${dest.coordinates.lat}`}>
                    <button
                      type="button"
                      role="option"
                      onClick={() => handleChooseDestination(dest)}
                      className="w-full px-4 py-3.5 text-left hover:bg-[#F8F6F1] transition-colors flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <MapPin
                          className="w-4 h-4 text-[#1B4B3A] shrink-0 mt-1"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-[#17211C] truncate">
                            {dest.name}
                            {dest.state && dest.state !== dest.name ? (
                              <span className="font-normal text-[#4B5650]">, {dest.state}</span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-[#4B5650]">
                            {formatLocationTypeLabel(dest.locationType)} · {dest.geographicRegion}
                            {dest.district ? ` · ${dest.district}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-[#4B5650] whitespace-nowrap shrink-0 mt-0.5">
                        {formatCoordinates(dest.coordinates.lat, dest.coordinates.lng)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-4 py-2 bg-[#F8F6F1] border-t border-[#EFECE4] text-xs text-[#4B5650]">
                Geocoding powered by OpenStreetMap ({outcome.source === 'osm_photon' ? 'Photon' : outcome.source === 'cache' ? 'cached' : 'Nominatim'}) · All Indian states & UTs
              </div>
            </div>
          ) : outcome?.status === 'unsupported_location' ? (
            <div className="p-5 flex items-start gap-3 text-sm text-[#6B3F10] bg-[#FBF7F0]">
              <Globe className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold text-[#17211C]">Outside India</p>
                <p className="text-xs leading-relaxed">{outcome.message}</p>
              </div>
            </div>
          ) : outcome?.status === 'api_error' ? (
            <div className="p-5 flex items-start justify-between gap-4 text-sm text-[#7D2617] bg-[#FDF4F2]">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Geocoding temporarily unavailable</p>
                  <p className="mt-1 text-xs leading-relaxed">{outcome.message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#D7A297] rounded hover:bg-white whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          ) : outcome?.status === 'no_results' ? (
            <div className="p-5 text-sm text-[#4B5650] space-y-1">
              <p className="font-semibold text-[#17211C]">No matching Indian destination found</p>
              <p className="text-xs leading-relaxed">{outcome.message}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
