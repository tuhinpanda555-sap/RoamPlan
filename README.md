# RoamPlan — Pan-India Travel Itinerary Planner

RoamPlan is a React + TypeScript + Vite web application for discovering destinations across **all 28 Indian states and 8 union territories**, generating curated day-wise multi-location itineraries, comparing **Budget, Experience, and Luxury** cost tiers, and saving private trips to **Cloud Firestore** with **Firebase Google Sign-In**—built on a Vercel-compatible SPA architecture with zero paid API keys.

## Key Features

1. **Pan-India Dynamic Destination Discovery (OpenStreetMap)**
   - Search any Indian city, town, village, hill station, valley, beach destination, heritage site, or tourist region via debounced autocomplete.
   - Resolves each destination into **name, state/UT, coordinates (`lat`, `lng`), location type, and Indian geographic region** using **OpenStreetMap Nominatim** (`countrycodes=in`, rate-limit compliant) with **Komoot Photon** as an India-bounded fallback and 24-hour local/memory caching.
   - Queries the **OpenStreetMap Overpass API** (multi-mirror failover + 24-hour caching) around resolved coordinates to discover tourist attractions, natural landmarks, viewpoints, lakes & waterfalls, cultural & heritage sites, adventure locations, local areas, and nearby towns (12–55 km) for multi-stop journeys.
   - Provides honest loading, no-results, API-error, non-India (`unsupported_location`), and sparse-OSM fallback states—clearly distinguishing **Verified OpenStreetMap Locations** from **Estimated Planning Guidance** without inventing fictional landmarks.
   - Retains the 7 featured Himachal Pradesh destinations on the landing page strictly as **curated example guides**, never as a search restriction.

2. **Curated Day-Wise Itinerary Generator**
   - Supports all five travel intents: **Rest, Enjoy, Travel, Trek, and Adventure**.
   - Scores discovered POIs by intent, user interests, category diversity, tier sensibility, and geographic proximity rather than returning an unfiltered attraction dump.
   - Builds multi-stop journeys using discovered nearby towns when trip duration permits, never exceeding the user's selected day count.
   - Uses contextual regional Budget / Experience / Luxury stay planning bands—never fabricating hotel names, availability, reviews, or confirmed bookings (verified marketplace inventory is planned for a future release).

3. **4-Category Budget Comparison & Live Recalculation**
   - Side-by-side **Budget**, **Experience**, and **Luxury** options broken down into **Accommodation**, **Transportation**, **Activities & Landmarks**, and **Food**.
   - Replace stay bands or activities, add discovered landmarks or self-paced windows, or remove items in the editor with instant automatic total recalculation.

4. **Editorial Typography & Visual System**
   - **`DM Serif Display`** for display headings and destination titles, **`DM Sans`** for clean readable UI/body copy, and **`DM Mono`** (`tabular-nums`) for INR totals, coordinates, and travel metrics.
   - Warm editorial cream canvas (`#F8F6F1`), pine-green primary accent (`#1B4B3A`), deep readable charcoal ink (`#17211C`), generous card spacing, and consistent accessible button heights.

5. **Firebase Authentication (Google Sign-In) & Cloud Firestore**
   - Explore destinations and generate draft itineraries publicly; sign in with Google to save private trips and unconfirmed sample enquiries to **Cloud Firestore**.
   - Full Create, Read, Update, and Delete (CRUD) synced across devices under the authenticated user's UID, with loading, empty, and retryable error states.
   - Existing browser `localStorage` trips are detected automatically after sign-in and offered for one-click deduplicated migration to Cloud Firestore.

## External Data Sources & Usage Policies

| Service | Purpose | Auth / Key | Rate-Limit & Reliability Handling |
| :--- | :--- | :--- | :--- |
| **OpenStreetMap Nominatim** | Primary India destination geocoding (`countrycodes=in`) | None (public) | 340ms debounce, 1.1s client request throttle, 24h memory + `localStorage` cache |
| **Komoot Photon** | India-bounded geocoding fallback (`bbox=68.0,6.5,97.5,37.5`) | None (public) | Triggered automatically if Nominatim returns empty or fails; 24h cache |
| **OpenStreetMap Overpass API** | Geospatial POI & nearby-town discovery | None (public) | Multi-mirror failover (`overpass-api.de`, `overpass.kumi.systems`), 8.5s timeout, 24h cache, honest partial-itinerary fallback |
| **Firebase Auth & Cloud Firestore** | Google Sign-In & private trip persistence | Public Web SDK config (`firebase-applet-config.json`) | Owner-only Firestore Security Rules; zero private keys in frontend |
| **Google Fonts** | `DM Serif Display`, `DM Sans`, `DM Mono` | None | Loaded via `<link>` in `index.html` with system fallbacks |

## Cloud Firestore Data Model & Security Rules (`firestore.rules`)

```text
/users/{uid}                                       # Authenticated user profile (displayName, email, photoURL)
/users/{uid}/trips/{tripId}                        # Private saved itineraries with 4-category cost totals
/users/{uid}/trips/{tripId}/items/{itemId}         # Day-wise itinerary line items (stays, transport, activities, food)
/users/{uid}/bookingRequests/{requestId}           # Unconfirmed sample enquiries (status locked to "requested")
```

All Cloud Firestore collections enforce owner-only access (`request.auth != null && request.auth.token.email_verified == true && request.auth.uid == uid`), default-deny catch-all, bounded string/array validation, exact 4-category accounting (`estimatedTotalInr == accommodationInr + transportationInr + activitiesInr + foodInr`), and immutable audit fields.

> **Security Note**: `npx eslint firestore.rules` passes cleanly. Before sharing this application broadly in production, please review and further harden `firestore.rules` for your specific operational requirements.

## Local Development & Verification

```bash
# Install dependencies
npm install

# Run local dev server (http://localhost:3000)
npm run dev

# TypeScript type check
npm run lint

# Lint Firestore Security Rules
npx eslint firestore.rules

# Run automated pan-India discovery, itinerary engine & Firestore compatibility tests
npx tsx scripts/verify-mvp.ts

# Production build for Vercel
npm run build
```

## GitHub & Vercel Deployment Instructions

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "RoamPlan pan-India dynamic destination discovery & typography upgrade"
   git push origin main
   ```
2. **Import into Vercel**:
   - Sign in to [vercel.com](https://vercel.com/) → **Add New → Project** → import your GitHub repository.
   - **Framework Preset**: `Vite`, **Build Command**: `npm run build`, **Output Directory**: `dist`.
3. **Add Your Vercel Domain to Firebase Authorized Domains**:
   - Open Firebase Console → **Authentication → Settings → Authorized domains** → add your Vercel domain so Google Sign-In popups succeed in production.
