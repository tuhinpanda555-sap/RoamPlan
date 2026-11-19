import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, Lock, X } from 'lucide-react';
import { UNCONFIRMED_ENQUIRY_NOTICE } from '../data/sampleCatalogue';
import { formatInr } from '../engine/itineraryEngine';
import { formatReadableFirestoreError } from '../services/firebase';
import { AuthUserProfile, BookingEnquiryDraft, BookingRequest } from '../types/roamplan';

interface BookingEnquiryModalProps {
  draft: BookingEnquiryDraft;
  user: AuthUserProfile | null;
  authBusy: boolean;
  onSignIn: () => void;
  onClose: () => void;
  onSubmitEnquiry: (
    draft: BookingEnquiryDraft,
    contactName: string,
    contactEmail: string,
    specialNotes: string
  ) => Promise<BookingRequest>;
  onViewEnquiries: () => void;
}

export function BookingEnquiryModal({
  draft,
  user,
  authBusy,
  onSignIn,
  onClose,
  onSubmitEnquiry,
  onViewEnquiries,
}: BookingEnquiryModalProps) {
  const [contactName, setContactName] = useState(user?.displayName ?? '');
  const [contactEmail, setContactEmail] = useState(user?.email ?? '');
  const [preferredDate, setPreferredDate] = useState(draft.preferredDate);
  const [travellers, setTravellers] = useState(String(draft.travellers));
  const [specialNotes, setSpecialNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<BookingRequest | null>(null);

  useEffect(() => {
    if (user) {
      setContactName((prev) => (prev.trim().length > 0 ? prev : user.displayName));
      setContactEmail((prev) => (prev.trim().length > 0 ? prev : user.email));
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onSignIn();
      return;
    }

    const cleanName = contactName.trim();
    const cleanEmail = contactEmail.trim();
    const numTravellers = Number(travellers);

    if (cleanName.length < 2) {
      setErrorMessage('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Please provide a valid contact email address.');
      return;
    }
    if (!preferredDate) {
      setErrorMessage('Please select a preferred date.');
      return;
    }
    if (!Number.isInteger(numTravellers) || numTravellers < 1 || numTravellers > 12) {
      setErrorMessage('Number of travellers must be between 1 and 12.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const created = await onSubmitEnquiry(
        {
          ...draft,
          preferredDate,
          travellers: numTravellers,
        },
        cleanName,
        cleanEmail,
        specialNotes
      );
      setSubmittedRequest(created);
    } catch (error) {
      setErrorMessage(formatReadableFirestoreError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enquiry-modal-title"
      className="fixed inset-0 z-50 bg-[#17211C]/55 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white border border-[#DFD9CE] rounded-lg max-w-lg w-full p-6 sm:p-7 my-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-[#4B5650]">
              Unconfirmed Sample Enquiry ·{' '}
              {draft.itemType === 'accommodation' ? 'Stay' : 'Activity'}
            </p>
            <h2 id="enquiry-modal-title" className="mt-1 font-editorial text-2xl text-[#17211C]">
              {draft.itemName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close booking enquiry form"
            className="w-9 h-9 flex items-center justify-center text-[#4B5650] hover:text-[#17211C] rounded-md hover:bg-[#EFECE4]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mandatory Booking Transparency Notice */}
        <div className="mt-4 p-3.5 bg-[#FBF7F0] border border-[#E6D6BC] rounded-md flex items-start gap-2.5 text-xs text-[#6B3F10]">
          <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed font-medium">{UNCONFIRMED_ENQUIRY_NOTICE}</p>
        </div>

        {!user ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-[#F8F6F1] border border-[#DFD9CE] rounded-md flex items-start gap-3">
              <Lock className="w-4 h-4 text-[#1B4B3A] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-[#4B5650] space-y-1">
                <p className="font-semibold text-sm text-[#17211C]">
                  Google Sign-In required to submit enquiries
                </p>
                <p className="leading-relaxed">
                  Sample booking enquiries are saved privately under your authenticated Google
                  account in Cloud Firestore so you can track them across sessions.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[#4B5650] border border-[#D8D1C4] hover:bg-[#EFECE4] rounded-md min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={authBusy}
                onClick={onSignIn}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md min-h-[40px]"
              >
                {authBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                <span>{authBusy ? 'Signing in…' : 'Sign in with Google'}</span>
              </button>
            </div>
          </div>
        ) : submittedRequest ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-[#F1F6F3] border border-[#CFE0D8] rounded-md flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#1B4B3A] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-[#17211C] space-y-1">
                <p className="font-semibold text-sm">
                  Sample Enquiry Saved to Cloud Firestore (Status: Requested — Unconfirmed)
                </p>
                <p className="text-[#4B5650]">
                  Reference ID: <span className="font-mono">{submittedRequest.id}</span>
                </p>
                <p className="text-[#4B5650]">
                  Stored privately under {user.email}. This is not a confirmed booking, and no
                  payment has been collected.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[#4B5650] border border-[#D8D1C4] hover:bg-[#EFECE4] rounded-md"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewEnquiries();
                }}
                className="px-4 py-2 text-xs font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] rounded-md"
              >
                View in My Trips
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mt-5 space-y-4">
            <dl className="p-3.5 bg-[#F8F6F1] border border-[#DFD9CE] rounded-md text-xs space-y-1.5">
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Destination</dt>
                <dd className="text-[#17211C] font-medium">{draft.destinationName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Sample Listing</dt>
                <dd className="text-[#17211C]">{draft.providerName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#4B5650]">Illustrative Estimate</dt>
                <dd className="font-mono tabular-nums text-[#17211C] font-medium">
                  {formatInr(draft.estimatedTotalInr)} ({draft.durationLabel})
                </dd>
              </div>
            </dl>

            {errorMessage && (
              <div
                role="alert"
                className="p-3 bg-[#FDF4F2] border border-[#E5B9B0] rounded-md flex items-start gap-2 text-xs text-[#7D2617]"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="enq-name" className="block text-xs font-semibold text-[#17211C] mb-1">
                  Contact Name
                </label>
                <input
                  id="enq-name"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 text-sm border border-[#D8D1C4] rounded-md focus:outline-none focus:border-[#1B4B3A] min-h-[42px]"
                />
              </div>
              <div>
                <label
                  htmlFor="enq-email"
                  className="block text-xs font-semibold text-[#17211C] mb-1"
                >
                  Contact Email
                </label>
                <input
                  id="enq-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 text-sm border border-[#D8D1C4] rounded-md focus:outline-none focus:border-[#1B4B3A] min-h-[42px]"
                />
              </div>
              <div>
                <label htmlFor="enq-date" className="block text-xs font-semibold text-[#17211C] mb-1">
                  Preferred Date
                </label>
                <input
                  id="enq-date"
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D8D1C4] rounded-md focus:outline-none focus:border-[#1B4B3A] min-h-[42px]"
                />
              </div>
              <div>
                <label
                  htmlFor="enq-travellers"
                  className="block text-xs font-semibold text-[#17211C] mb-1"
                >
                  Travellers
                </label>
                <input
                  id="enq-travellers"
                  type="number"
                  min={1}
                  max={12}
                  value={travellers}
                  onChange={(e) => setTravellers(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D8D1C4] rounded-md focus:outline-none focus:border-[#1B4B3A] min-h-[42px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="enq-notes" className="block text-xs font-semibold text-[#17211C] mb-1">
                Notes or Questions (optional)
              </label>
              <textarea
                id="enq-notes"
                rows={3}
                value={specialNotes}
                onChange={(e) => setSpecialNotes(e.target.value)}
                placeholder="e.g., Dietary preferences, trail fitness notes, winter heater..."
                className="w-full px-3 py-2 text-sm border border-[#D8D1C4] rounded-md focus:outline-none focus:border-[#1B4B3A]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EFECE4]">
              <span className="text-[11px] text-[#4B5650]">
                No payment or live booking confirmation.
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-[#4B5650] border border-[#D8D1C4] hover:bg-[#EFECE4] rounded-md min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#F8F6F1] bg-[#1B4B3A] hover:bg-[#13382B] disabled:opacity-65 rounded-md min-h-[40px]"
                >
                  {isSubmitting && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  )}
                  <span>{isSubmitting ? 'Saving…' : 'Save Unconfirmed Enquiry'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
