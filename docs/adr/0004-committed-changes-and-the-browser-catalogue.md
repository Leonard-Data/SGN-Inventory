# Committed changes and the browser property catalogue

Status: accepted (2026-10-20)

The browser catalogue ([ADR 0003](0003-browser-property-catalogue-and-local-address-search.md)) is a browsing snapshot, so a save, a create, a merge, a status change, an approval or a lock decision left the list showing a property the server no longer agreed with until the person refreshed. The dangerous case is a change racing a refresh: the replacement catalogue is read while the change commits, so the older answer would win if it were simply swapped in.

We decided a committed change is applied over the catalogue rather than merged into it. Every mutation endpoint answers with the affected property's authoritative summary, read back from the server after the change committed - never the values that were submitted - and the browser records that answer as the latest change for that property. The catalogue a consumer reads is the rows a read produced with every recorded change applied on top, so a page, a retry or a replacement catalogue whose read started before the change can never overwrite it. The property's own `updated_at` is the server-maintained revision: a read that answers with a strictly later modification time is the newer authority and keeps its row. The affected property's addresses are folded again from the summary alone, so search finds it under its current address and not the one it moved from, and the active local query and ranking are re-evaluated from the reconciled rows. A summary the server answers with as `null` removes the property; a response that carried no summary at all is the admission that the change committed but its current values could not be read back, so the browser reads the catalogue again from the server rather than keeping a row nothing confirms.

Locking and approval stay the database's decision: the browser's cached status never authorizes a lock, and a refusal that means the committed state moved on (`reservation-conflict`, `reservation-unavailable`, `reservation-closed`) makes the panel re-read the property from the server. The panel offers its request form from the status that re-read reported, and the conflict is stated above the panel's controls, so a refresh that removes the form the refusal came from cannot remove the conflict with it.

## Considered options

- Updating the cached row optimistically from the submitted values - rejected: the list would show what was typed rather than what the server recorded, and a server-derived field (a recorded address text, an applied status) would be wrong until the next refresh.
- Invalidating the whole catalogue after every change - rejected as the ordinary path: it throws away a 12.5 MB authorized snapshot and re-reads it to reflect one property, which is the latency this feature exists to remove. It remains the fallback when the server commits a change but cannot hand its summary back, because then there is no answer to apply and one property cannot be repaired on its own.
- Reading the property again from the browser after the change - rejected as the primary path: the committed write already returns, so a second request is one more round trip that can fail and leave the list stale even though the change succeeded. The read-back happens inside the mutation response instead.
- Blocking the mutation until no catalogue read is in flight - rejected: it makes a person wait on a background traversal they did not ask for, and the reconcile rule makes the wait unnecessary.
- Discarding the replacement catalogue when a change lands during it - rejected: a refresh that completed would be thrown away, and the next refresh would race the same way.

## Consequences

- The browser keeps one change per property, latest last, for the authorized scope it belongs to; a scope change starts a new generation with no change carried over, and a change that a later read has already incorporated is superseded by that read's later modification time.
- The catalogue's progress indicator still describes the load rather than the changes: `loadedCount` counts the rows the traversal indexed, and a created or removed property changes the list without rewriting the traversal's own progress.
- Mutation responses now carry the summary, so every write surface applies it; the endpoints' eligibility and projection are the catalogue read's own, so a response can never carry a summary the catalogue would not answer with.
- The one catalogue key keeps its unbounded retention while the shared query client's defaults are bounded, so explicit advanced-search results ([#194](https://github.com/Leonard-Data/SGN-Inventory/issues/194)) get their own bounded lifetime rather than inheriting the catalogue's.
- The rule lives in `src/features/properties/catalogue-changes.ts` and is applied by `catalogue-provider.tsx`; the replacement catalogue of [#190](https://github.com/Leonard-Data/SGN-Inventory/issues/190) must reconcile through the same function before it is swapped in.
