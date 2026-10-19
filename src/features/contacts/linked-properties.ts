// A shared contact may have many properties; opening its editor must not start an unbounded fan-out.
export async function readLinkedProperties<T>(
  ids: readonly string[],
  read: (id: string) => Promise<T>,
  publish: (batch: T[]) => void,
  signal: AbortSignal,
) {
  for (let start = 0; start < ids.length && !signal.aborted; start += 4) {
    const batch = await Promise.all(ids.slice(start, start + 4).map(read));
    if (!signal.aborted) publish(batch);
  }
}
