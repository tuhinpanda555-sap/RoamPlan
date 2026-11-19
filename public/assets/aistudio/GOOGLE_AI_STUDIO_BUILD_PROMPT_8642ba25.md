# Google AI Studio Build Mode — Master Prompt

Build a production-minded academic MVP called **RoamPlan** (working name) based on the complete product brief below. This is a real functional web application, not a static mockup. Use React + TypeScript and a Vercel-compatible deployment setup. Use Firebase Authentication with Google sign-in and Cloud Firestore for persistent data. Do not deploy to Cloud Run as the final hosting target; our required host is Vercel.

## Product brief
RoamPlan is an integrated travel planning and experience platform. It helps users discover stays and experiences, create budget-aware multi-location itineraries, submit booking enquiries, and manage trip progress. It is not merely a hotel listing site.

### Main user journey
1. Public landing page with destination search.
2. Planning wizard collects destination, start date, number of days, travellers, total budget, interests, and travel intent.
3. Travel intents: Rest, Enjoy, Travel, Trek, Sports & Adventure.
4. Generate three itinerary styles: Budget Explorer, Experience Seeker, Luxury Traveller.
5. Show a day-wise itinerary with stops, accommodation suggestions, experiences, notes, and itemized estimated costs.
6. Allow users to replace/remove itinerary items and recalculate totals.
7. Google sign-in lets users save and manage their own trips.
8. Users can submit accommodation/experience booking enquiries.
9. Dashboard shows saved trips, itinerary progress, and enquiry statuses.

### Important product truthfulness
No travel supplier API credentials are currently available. Use a small, clearly labelled curated/sample catalogue for the academic MVP. Never claim live availability, confirmed reservations, or real-time supplier prices. A booking action must create a booking enquiry/request with status `requested`, not a confirmed booking. Display a clear notice: "This is an enquiry request; your reservation is not confirmed until the provider confirms it." Do not add payment collection.

### Travel intent behavior
- Rest: accommodation-first recommendations, with optional nearby activities.
- Enjoy: stay plus local food, culture, sightseeing, and experiences.
- Travel: multi-stop itinerary and intermediary stays.
- Trek: show duration, difficulty, season notes, guide/operator enquiry, and safety notes. Do not invent safety guarantees.
- Sports & Adventure: show activity options, estimated costs, season notes, provider details where known, and safety notes.

### Budget styles
- Budget Explorer: economical accommodation and low-cost/free experiences.
- Experience Seeker: distinctive stays and high-value local experiences.
- Luxury Traveller: premium stays and premium experiences.
All amounts are estimates. Compute totals deterministically from itemized costs. Respect duration and budget constraints. If no option fits, explain why rather than silently exceeding budget.

### Data model
Create Firestore collections/documents for:
- `users/{uid}`
- `destinations/{destinationId}`
- `accommodations/{accommodationId}`
- `experiences/{experienceId}`
- `trips/{tripId}`
- `trips/{tripId}/itineraryItems/{itemId}`
- `bookingRequests/{requestId}`
Include owner UID on private records, timestamps, provenance, and request status. Seed a modest, clearly labelled sample catalogue for Manali and nearby Himachal destinations, with illustrative estimates only. Do not imply these are verified current rates or actual provider inventory.

### Security
- Implement Firebase Google authentication.
- Configure Firestore rules so public users can read published catalogue records, while only authenticated owners can read/write their own trips, itinerary items, and booking requests.
- Do not trust client-side ownership checks alone.
- Never expose service-account credentials or private API keys in frontend code.
- Provide a clear checklist for authorized domains and production Firebase configuration.

### UI/UX
Create a polished, credible travel product interface, mobile-first and responsive. Use a refined editorial travel aesthetic: strong destination photography, warm neutral surfaces, deep forest/charcoal text, restrained accent color, clean typography, generous spacing, accessible contrast, loading states, empty states, and useful validation. Avoid generic dashboard templates. Main navigation: Explore, Plan a Trip, My Trips, Sign in/profile.

### Required screens
1. Landing / Explore.
2. Destination details.
3. Trip planning wizard.
4. Itinerary comparison/results.
5. Itinerary detail/editor.
6. Google sign-in state.
7. My Trips dashboard.
8. Booking enquiry form and status view.
9. Basic about/how-it-works and clear sample-data disclosure.

### Acceptance tests
- Public visitor can browse published sample catalogue.
- Valid trip input generates options.
- Invalid input shows useful validation.
- Itinerary totals equal sum of line items and update after edits.
- Google sign-in works.
- Saved trip persists after refresh.
- User A cannot read or modify User B's private data.
- Enquiry is saved and is visibly labelled unconfirmed.
- Completion toggles update trip progress.
- Responsive on phone and desktop.
- No secrets committed to Git.

### Implementation instructions
1. First inspect the project structure and choose a Vercel-compatible React + TypeScript setup.
2. Implement the core UI and deterministic itinerary/budget engine before adding AI-generated copy.
3. Add Firebase Authentication and Firestore persistence.
4. Add Firestore Security Rules and explain how to test them.
5. Add seed data only as clearly labelled curated/sample inventory.
6. Add robust loading, error, and empty states.
7. Run build/type checks and fix all errors.
8. Provide a README with local setup, environment variables, Firebase configuration, security-rule deployment, GitHub synchronization, and Vercel deployment instructions.
9. Ensure `.env*`, credentials, and private keys are gitignored.
10. Do not claim deployment or provider integration has succeeded unless actually verified.

Before making broad changes, present a concise implementation plan and identify any Firebase setup action requiring the user's approval. Then implement the app in small verifiable steps.
