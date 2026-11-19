import { TripRecord } from '../types/roamplan';

/**
 * Pure deduplication helper: returns only localStorage trips not already present in Cloud Firestore.
 * Checks both explicit `localSourceId` lineage and trip content signatures to prevent duplicates
 * across repeated migrations or multi-device sign-ins.
 */
export function filterUnmigratedLocalTrips(
  localTrips: TripRecord[],
  cloudTrips: TripRecord[]
): TripRecord[] {
  const migratedSourceIds = new Set(
    cloudTrips.map((t) => t.localSourceId).filter((id): id is string => Boolean(id))
  );
  const cloudSignatures = new Set(
    cloudTrips.map(
      (t) =>
        `${t.title.trim().toLowerCase()}|${t.destinationId}|${t.startDate}|${t.days}|${t.estimatedTotalInr}`
    )
  );

  return localTrips.filter((local) => {
    if (migratedSourceIds.has(local.id)) return false;
    const sig = `${local.title.trim().toLowerCase()}|${local.destinationId}|${local.startDate}|${local.days}|${local.estimatedTotalInr}`;
    if (cloudSignatures.has(sig)) return false;
    return true;
  });
}
