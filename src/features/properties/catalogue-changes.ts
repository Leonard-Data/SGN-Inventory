// What the browser does with a change the server has committed: the authoritative summary the
// server's own response carried replaces what the catalogue held for that property (or removes
// it), that property's addresses are folded again so search finds it under its current address,
// and the change stays on top of whatever a catalogue read answers with afterwards. A read that
// started before the change committed therefore can never overwrite it - neither the next batch of
// the traversal nor a replacement catalogue swapped in later (issue #193). When the server commits
// a change but cannot hand its summary back, the catalogue is read again from the server instead
// of keeping a row nothing authoritative confirms.
//
// Everything here is shaping over values the browser already holds, so applying a server response,
// reindexing after an address change, the filter and ranking that follow it, and the
// reconcile-before-swap rule are testable without a browser or a database. The read that produces
// the authoritative summary is `catalogue-data.ts`; the write surfaces that hand it here are the
// mutation routes.
import {
  buildAddressIndex,
  type CatalogueIndexEntry,
} from './address-index.ts';
import type { PropertySummary } from './types';

// One change the server reported after committing it. An upsert carries the summary the server's
// own read answered with - never the values that were submitted - and a removal names the property
// the server's answer no longer carries (deleted, archived or no longer readable).
export type CatalogueChange =
  { kind: 'upsert'; summary: PropertySummary } | { kind: 'remove'; id: string };

// What one server answer states about the property a change committed for. It is a change, or the
// admission that the change committed but its summary could not be read back: the browser then
// holds no authoritative value for that property and reads the catalogue again from the server
// rather than keeping a row the server may no longer agree with.
export type CatalogueAnswer =
  CatalogueChange | { kind: 'unreconciled'; id: string };

export function changedProperty(change: CatalogueChange): string {
  return change.kind === 'upsert' ? change.summary.id : change.id;
}

// The answer one server response states. A summary the server answered with is the change; a
// response that carries no summary for the property (null) states that the property is no longer
// in the caller's catalogue, so the browser drops it rather than keeping a record the server has
// already stopped answering with. An unreadable summary (undefined) states that the change
// committed and its current values are unknown to this answer.
export function summaryChange(
  summary: PropertySummary | null | undefined,
  propertyId: string,
): CatalogueAnswer {
  if (summary === undefined) return { kind: 'unreconciled', id: propertyId };
  return summary === null
    ? { kind: 'remove', id: propertyId }
    : { kind: 'upsert', summary };
}

// Report the answer one mutation response gave: what the server said about the property becomes
// the catalogue's row for it, and an answer that could not carry the record back makes the
// catalogue read the property again from the server instead of silently keeping what it held.
export function applyServerSummary(
  report: (answer: CatalogueAnswer) => void,
  result: { summary?: PropertySummary | null },
  propertyId: string,
): void {
  report(summaryChange(result.summary, propertyId));
}

// Record a committed change: the latest change to a property replaces any earlier one, so the log
// holds at most one entry per property while keeping the order the changes were applied in.
export function recordCatalogueChange(
  changes: readonly CatalogueChange[],
  change: CatalogueChange,
): CatalogueChange[] {
  const id = changedProperty(change);
  return [...changes.filter((other) => changedProperty(other) !== id), change];
}

// The index entry one summary states: only this property's own variants are folded again, so the
// rest of the catalogue is untouched and the affected addresses are reindexed from the recorded
// text the server answered with.
export function catalogueEntry(summary: PropertySummary): CatalogueIndexEntry {
  // One property folds to exactly one entry, so the first is the only one; the entry carries the
  // folded code beside its variants, which is why it is built rather than assembled by hand.
  const [entry] = buildAddressIndex([summary]);
  if (!entry) throw new Error('a summary always folds to one catalogue entry');
  return entry;
}

// Whether the row a read answered with is newer than the change the browser applied. The property's
// own modification time is the server-maintained revision: a read committed after the change is
// the newer authority and keeps its row, while an equal or older row never displaces the change.
function rowIsNewer(row: PropertySummary, summary: PropertySummary): boolean {
  return (
    row.updatedAt !== null &&
    summary.updatedAt !== null &&
    row.updatedAt > summary.updatedAt
  );
}

// The catalogue the browser should show: the rows a read produced - a batch of the traversal, or a
// replacement catalogue about to be swapped in - with every change the server has committed for it
// applied on top before anything reads it. A property the catalogue does not carry yet is appended
// in the order the changes were applied, so a created property appears at the end of the loaded
// rows exactly as a page's own new rows do.
export function reconcileCatalogue(
  index: readonly CatalogueIndexEntry[],
  changes: readonly CatalogueChange[],
): readonly CatalogueIndexEntry[] {
  if (changes.length === 0) return index;
  const latest = new Map<string, CatalogueChange>();
  for (const change of changes) latest.set(changedProperty(change), change);
  const rows: CatalogueIndexEntry[] = [];
  for (const entry of index) {
    const change = latest.get(entry.record.id);
    if (!change) {
      rows.push(entry);
      continue;
    }
    latest.delete(entry.record.id);
    if (change.kind === 'remove') continue;
    rows.push(
      rowIsNewer(entry.record, change.summary)
        ? entry
        : catalogueEntry(change.summary),
    );
  }
  for (const change of changes) {
    if (change.kind === 'remove' || !latest.delete(change.summary.id)) continue;
    rows.push(catalogueEntry(change.summary));
  }
  return rows;
}
