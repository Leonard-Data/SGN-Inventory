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

// A refused completion can never become readable, so its bytes are discarded while the row is
// retained as evidence and its class slot is released.
export async function discardRefusedCompletion(
  deps: CleanupStore & {
    pendingOwnerPath: () => Promise<string | null>;
    fail: () => Promise<void>;
  },
): Promise<void> {
  const objectPath = await deps.pendingOwnerPath();
  if (!objectPath) return;
  try {
    await deps.remove(objectPath);
  } catch (error) {
    deps.log(`could not remove refused upload ${objectPath}: ${String(error)}`);
  }
  await deps.fail();
}
