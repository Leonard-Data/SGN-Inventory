// The upload window and its cleanup. The signed upload policy lives 60 seconds, so a
// registration still pending after 15 minutes can no longer receive bytes; the storage-limits
// migration applies the same window to its class-slot count.
export const pendingUploadMs = 15 * 60_000;

export type CleanupStore = {
  remove: (objectPath: string) => Promise<void>;
  log: (message: string) => void;
};

export function expiredPendingRegistration(
  file: { upload_status: string; created_at: string },
  now: number,
): boolean {
  return (
    file.upload_status === 'pending' &&
    Date.parse(file.created_at) <= now - pendingUploadMs
  );
}

// 'absent' only once the bytes are really gone: a failed removal stays 'unknown' so an outage
// is never read as permission to upload over bytes that may still exist.
export async function discardExpiredRegistration(
  store: CleanupStore,
  objectPath: string,
): Promise<'absent' | 'unknown'> {
  try {
    await store.remove(objectPath);
    return 'absent';
  } catch (error) {
    store.log(
      `could not discard expired upload ${objectPath}: ${String(error)}`,
    );
    return 'unknown';
  }
}

// Deletes a released registration's bytes, then records that they are gone. A failed removal
// leaves the row eligible for cleanup, so the next sweep retries it.
export async function sweepReleasedBytes(
  store: CleanupStore,
  objectPath: string,
  confirmCleaned: () => Promise<void>,
): Promise<boolean> {
  try {
    await store.remove(objectPath);
  } catch (error) {
    store.log(
      `could not remove ${objectPath}; the next sweep retries: ${String(error)}`,
    );
    return false;
  }
  try {
    await confirmCleaned();
  } catch (error) {
    store.log(
      `could not record cleaned upload ${objectPath}: ${String(error)}`,
    );
    return false;
  }
  return true;
}

// A refused completion releases its class slot at once and discards its bytes. Only a confirmed
// removal moves the row to 'failed'; otherwise it stays 'cleanup_pending' for a later sweep.
export async function discardRefusedCompletion(
  deps: CleanupStore & {
    pendingOwnerPath: () => Promise<string | null>;
    releaseSlot: () => Promise<void>;
    confirmCleaned: () => Promise<void>;
  },
): Promise<void> {
  const objectPath = await deps.pendingOwnerPath();
  if (!objectPath) return;
  try {
    await deps.releaseSlot();
  } catch (error) {
    deps.log(
      `could not release refused upload ${objectPath}: ${String(error)}`,
    );
    return;
  }
  await sweepReleasedBytes(deps, objectPath, deps.confirmCleaned);
}
