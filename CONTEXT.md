# SGN inventory domain

One company's shared property inventory, employee access, contacts, reservations and rental records.

## Language

### Employees and access

**Employee invitation**:
An offer to join the company's internal inventory, recorded against the intended employee and address. Acceptance by that intended invitee links and activates the retained employee immediately, with no separate approval.
_Avoid_: Access approval

**Resent invitation**:
A further send of the same recorded invitation to the same recorded address, for a link that expired or was lost. It keeps the recorded role and the recorded acceptance, creates no second invitation, and is never available once the invitation was accepted or the account is linked or active.
_Avoid_: Re-invite, new invitation

**Linked employee**:
An employee whose sign-in identity has been confirmed as belonging to that employee.
_Avoid_: Email match

**Active employee**:
A linked employee whose company inventory access is enabled. Active employees share internal owner and broker contacts.
_Avoid_: Signed-in employee, active session

**Inactive employee**:
An employee whose company inventory access is disabled, regardless of whether they can still authenticate.
_Avoid_: Signed-out employee

**Unlinked employee**:
An employee record with no confirmed sign-in identity that has never had one confirmed and recorded as deleted. It is a distinct access state, not a disabled account. A recorded invitation is separate lifecycle evidence: it does not make the employee linked, and an unlinked person with no recorded invitation is not invited.
_Avoid_: Invited employee

**Account-deleted employee**:
A retained employee whose sign-in account was permanently deleted after the provider confirmed it absent. The employee row, UUID, name, role, locale, every business reference and every uploader attribution remain; the state is terminal in this release, so the person is never presented as merely inactive or as an imported, never-linked record.
_Avoid_: Deleted employee row, anonymized person, re-invitable account

**Employee interface language**:
The employee's preferred Vietnamese or English interface language. It is independent of the language of addresses, source records and signed documents.
_Avoid_: Record language

**Employee bio**:
One optional plain-text line about themselves, at most 280 characters, stored on the employee record without markup or a link. The person writes it on their own profile page and an admin may edit it with the rest of their details; it is shown on the employee's entry in the admin employee directory, which stays admin-only.
_Avoid_: About text, rich profile, description field

**My profile**:
The signed-in employee's own display name and bio, reached from the account menu. It acts only on the person signed in and offers no phone, role, email or access change; phone and role stay admin-edited from the employee directory.
_Avoid_: Account settings, employee edit page

**Employee profile edit**:
The admin edit of one recorded employee's display name, phone, role and bio on the employees page, saved as one deliberate action that reports what changed. The sign-in email is not an editable field, a deactivated or account-deleted employee is refused, and a role change is recorded with the admin who made it.
_Avoid_: Employee update, direct table write

**Employee deactivation**:
The controlled disabling of a linked employee's company inventory access, completed only after the exact sign-in block is confirmed by the sign-in provider. Membership is disabled first and an unconfirmed provider result stays a reconciliation state, not a completed deactivation.
_Avoid_: Access patching, account deletion

**Employee account deletion**:
The permanent removal of one employee's sign-in account, completed only after the provider confirms the account is absent. Membership is disabled and the restrictive Auth link cleared first, owned files have their technical ownership reassigned to a live active admin custodian, and the retained employee, their work and their attribution are never erased, reassigned or anonymized. An Auth or Storage failure stays a visible, resumable partial state.
_Avoid_: Employee deletion, record deletion, document deletion

**Storage ownership custodian**:
The live active admin whose sign-in identity becomes the technical owner of a departing employee's Storage objects before that employee's account is deleted. Only the ownership columns move; object identity, path, metadata, bytes and uploader attribution are unchanged.
_Avoid_: File re-upload, document transfer

**Administration operation**:
The durable, revision-checked record of one employee administration action, carrying the target, the acting admin, the submission key and the provider reconciliation state. It is retained evidence and is never rewritten or deleted.
_Avoid_: Audit entry, activation flag

**Deactivation reconciliation**:
The recorded pending or failed provider step of an administration operation whose sign-in block is not confirmed. Access stays disabled and any currently authorized admin may resume the original operation without rewriting its attribution.
_Avoid_: Successful deactivation, restored access

**Provider sign-in block**:
The finite ban applied to the exact linked sign-in identity through the server-only provider adapter, confirmed by the provider's own expiry. It is not an infinite state, it does not delete the identity or the employee record, and renewal requires an explicit reconciliation.
_Avoid_: Account removal, permanent ban

**Last active admin**:
The final active employee holding the admin role. The database refuses any deactivation, demotion, unlink or removal that would leave none, including through a direct write.
_Avoid_: Owner account, sole administrator

### Properties, addresses and contacts

**Property**:
The building or parcel represented by one inventory identity. An address change does not create a different property.
_Avoid_: Address record

**Property code**:
A stable, unique inventory reference assigned to a property. New property codes are assigned by the system; an address correction does not change the code.
_Avoid_: Address identifier, ward-based identity

**Archived property**:
A property retained for manager/admin review but excluded from ordinary inventory browsing. Reading its details is still a page view, not a physical visit.
_Avoid_: Deleted property, available listing

**Legacy address**:
A preserved historical address, including its original district-bearing source text.
_Avoid_: Incorrect address, current address

**Current address**:
A separate address under the applicable province/city and commune/ward structure, without a district. Its presence alone does not establish that its mapping is verified.
_Avoid_: Translated address, automatically converted address

**Administrative-unit reference catalog**:
The seeded official province/city, district and commune/ward list carrying official codes, parent links and one half-open validity window per official name, from two pinned upstream datasets that never share a source URL: the current two-tier generation from thanglequoc/vietnamese-provinces-database and the half-open `[2025-01-04, 2025-07-01)` legacy generation from sunshine-tech/VietnamProvinces, whose declared GPL-3.0-or-later licence with no LICENSE file is an open legal item rather than a settled one. It is a reference list for selection and hierarchy validation, not a property's verified address; a renamed unit reports the name in force on the address date, and a legacy address older than the snapshot date names a ward the catalog cannot offer and keeps its recorded text instead. Thirteen legacy communes the captain requested on 2026-10-23 sit on that same legacy window as locally coded entries marked by a source URL that states they are captain-requested, not official National Statistics Office units.
_Avoid_: Verified address, property-level mapping

**Legacy administrative-unit catalog**:
The pre-2025 three-tier province → district → ward generation, seeded on its half-open `[2025-01-04, 2025-07-01)` window so a legacy address can be looked up at all three levels. Separate from the current two-tier catalog because the two are different generations of the same official codes, and separate from the crosswalk below because it states what a unit was called, not what it became.
_Avoid_: Merged catalog, current hierarchy

**Administrative-unit crosswalk**:
The official old-to-new unit mapping, stating for each legacy unit whether it became one whole unit, a rename, or part of one or more successors. Its source table is ingested in full by migration — 10,023 of the 10,051 legacy wards covered, 28 with no accepted successor row — and it is migration-only: no client writes it, and a row is candidate evidence for a property's address, never a verification of one, so nothing is mapped automatically and a partial transition still needs property-level evidence.
_Avoid_: Verification, property-level mapping

**Composed address text**:
The one line an address is displayed and searched by, written by the server from the parts that address records — house number, street, commune, district and province for a legacy address, and the same line without the district for a current one, joined by ", " with a missing part skipped. The official name of the unit an address records wins over a recorded source label, which only names a level that records no unit. It is composed when an address is created or edited, while a mapping change moves only the units and leaves the recorded text as it is, and it is never typed beside those parts: a save or a correction that states one is refused. A created address must name a house number, a street or a commune picked from the catalog; a province alone, including the app's own, is not an address. A row imported with its own recorded wording keeps that wording.
_Avoid_: Typed known address, address label

**Address search**:
A match of a literal, accent-insensitive contiguous fragment against recorded addresses; `%` and `_` are ordinary characters.
_Avoid_: Fuzzy search, automatic ward mapping

**Unresolved address mapping**:
A legacy-to-current address relationship without sufficient reviewed evidence to identify the current administrative units.
_Avoid_: Verified match

**Recorded address candidate**:
A current address recorded from the official old-to-new crosswalk as the unverified statement of where a legacy ward became, kept beside the preserved legacy address it came from rather than replacing it. Any property editor may record one from a single whole or rename target; it states the source and its effective date, carries no reviewer stamp and is not a verification.
_Avoid_: Verified address, rewritten legacy address, automatic mapping

**Address format conversion**:
The one deliberate action that records an existing address in the other format beside it, as a candidate derived from the official crosswalk, while the converted address stays present and unmodified. An ordinary save never changes an address's format.
_Avoid_: Format toggle, rewritten address, automatic conversion

**Property contact link**:
The recorded relationship between a property and a contact, such as owner or broker. Several contacts may belong to a property, with at most one marked primary.
_Avoid_: Contact inferred from sheet position

**Duplicate address group**:
The unarchived properties whose primary address carries the same recorded address text after the same lowercased, accent-folded normalisation inventory search uses. Membership states that a decision is needed; it never means the records are the same property, because separate units in one house are an ordinary case.
_Avoid_: Duplicate property, automatic duplicate

**Address already recorded**:
The warning shown before a property is created when the address the save is about to store is already recorded, naming the unarchived properties that sit there with a link to open each. It informs and never blocks: a second property at the same building is an ordinary case, so the confirmation that creates anyway is one deliberate step, and an address nobody records creates with no added step at all. A match is decided by the same normalised address comparison the duplicate address group uses, on the address text the save will actually store.
_Avoid_: Address blocked, duplicate prevention, uniqueness check

**Property merge**:
The deliberate manager/admin decision that folds every other record in a duplicate address group into the group's most complete record, moving their photos, documents, history and contact links onto it and archiving the folded records.
_Avoid_: Automatic deduplication, import merge rule

**Folded property**:
A record whose content and links were moved onto the surviving property by a merge. It is retained and archived, still readable by a reviewer, and no longer appears in a duplicate address group.
_Avoid_: Deleted property, merged duplicate

**Property location**:
The recorded map point for a property, stored as a `latitude`/`longitude` pair that a staff editor sets or corrects by clicking a map during property-fact editing. It is saved through the same revision-checked maintenance path as the other facts, so it grants no separate editing authority and a change flags the record for review. Its absence is an unrecorded location, never a coordinate at the world origin.
_Avoid_: Address text as location, an empty world map pretending to be data

**Contact**:
A shared named party whose contact details may be used by several properties. Its relationship to each property is recorded separately as a property contact link.
_Avoid_: Property-specific phone record

**Shared-contact detail correction**:
A correction of the identity details of an existing shared Contact. Any Active employee may correct a Contact linked to a readable Property, whether opened from that Property or from the shared-contact directory, and staff/manager/admin may also correct an unlinked identity through the same operation (issue #72). It commits immediately and applies to the shared person for every Property linked at that moment; it is no longer recorded in the property change history, and it is separate from Property-fact authority: it does not create, link, unlink or merge contacts.
_Avoid_: Property-fact edit, contact creation, approval

**Record verification**:
An assessment of the accuracy of property facts and contact relationships, distinct from reservation approval. It is not a prerequisite for saving or displaying ordinary inventory changes and does not establish legal ownership.
_Avoid_: Legal approval, address verification

**Address mapping verification**:
A separate evidence-based assessment establishing the property's current administrative units. It is not approval to save an address or reserve a property.
_Avoid_: Record approval, automatic ward conversion

**Correction request**:
A recorded issue or proposed correction by an active employee concerning property facts, addresses, contact details or contact links on an unarchived property. Applying it resolves the request without an approval handoff; submission does not grant editing authority.
_Avoid_: Direct edit, completed correction

**Correction amendment**:
A separately attributed addition to an open Correction request's explanation, proposed correction and observed facts. It preserves the original submission rather than rewriting it.
_Avoid_: Replacement request, edited original

**Property change history**:
The record of who changed a Property's asking price, when, and its before/after values. Only recorded asking-price changes add rows; creation, address, contact, link, note and status changes are not recorded here — every non-price change is attributed in the private audit trail with the actor, time and before/after values, subject to that trail's own 90-day retention window, deliberately not the permanent record this history would have been — and rows recorded before this rule was applied are retained and stay readable. A status change has its own retained trail beside this one.
_Avoid_: Approval queue, page-view history

**Status change trail**:
A property's own retained record of every inventory-status change: who made it, the status it left and reached, the Vietnam time and the optional note that person typed. It is separate from the asking-price history and from the private audit trail, it names a decider for a request that needed one, and no status change creates a completed sale.
_Avoid_: Price history, approval queue, sale completion

**Direct status change**:
An inventory-status change an active employee applies without a reviewer: draft, available, negotiating and withdrawn at any time, and sold or rented when a manager or admin makes it. The change and its trail row are written in one transaction.
_Avoid_: Requested change, sale completion

**Status change request**:
A sold or rented change raised by an employee who is not a manager or admin. It changes no status while it waits, at most one waits on a property at a time, and a manager or admin other than the requester applies or rejects it with a reason. The decided request is retained in the same trail, naming the requester, the decider and the time.
_Avoid_: Reservation, approval queue entry, pending sale

**Asking-price history**:
A property's recorded sale asking prices and monthly asking rents, presented as separate newest-first series with the actor, Vietnam time and before/after whole-VND values of each saved change. An unknown value is a gap and a recorded zero stays zero; an untouched amount never appears as a change. Achieved sale prices, contractual rent, monthly dues and receipts are not part of either series, and no earlier price is invented.
_Avoid_: Market valuation, price list, achieved price, projected price

**Correction explanation**:
An optional retained note an authorized editor attaches to a recorded price correction. It stays with the revision it explains and never replaces the mistaken value, deletes earlier history or creates an approval step.
_Avoid_: Approval reason, price justification, replacement value

**Inventory entry date**:
The recorded original date a property entered the company inventory, preserved from a reliable legacy source date or recorded when a genuinely new property identity is created. It is not the record's creation, update or import time.
_Avoid_: Import day, created timestamp

**Unknown inventory entry date**:
An inventory record whose original entry date is not reliably recorded. It is an explicit known gap: it keeps its place in chronological lists after the dated records and has no invented or ranked age.
_Avoid_: Oldest record, guessed date

**Inventory age**:
The number of Vietnam business days from a property's Inventory entry date to today, shown in the chronological inventory views. It does not reset when a property is relisted, repriced, corrected or otherwise updated.
_Avoid_: Listing age, update age

**Inventory filter set**:
The optional conditions used to narrow inventory by status, listing mode, property type, how the property is reached (street front, car alley, motorbike alley, three-wheeler alley or unknown - the five states every record records, so the recorded unknown is a state to narrow to rather than an unstated filter), the address format a search is matched through (the legacy address, which is the default, or the current one), price, land or floor area in square metres, frontage and depth in metres, the administrative area of an address (the levels the stated address format has — province/city, district and commune/ward for a legacy address, province/city and commune/ward for a current one — each level narrowed by the one stated above it and every stated level applied to the same recorded address, the commune/ward level carrying one commune or a set of them so a search spans every record in any chosen commune, matched either by that level's recorded official unit or, for an address recorded only as text, by that level's own text once administrative type abbreviations are expanded to their full type and diacritics and spacing are folded, so a district is a legacy-address filter and a current-address search states none), a recorded contact linked to a property, or the records the signed-in employee created. The address format states one of its two formats, or no format condition once its chip is cleared: a property matches only when it records an address in the selected format, the typed query is compared with that format's own address, a property recording no address in that format does not match rather than being given one, and the cleared filter matches either recorded format. Status, listing mode, type, access type, address format, price, area, frontage, depth and the reader's own records are answered from the loaded catalogue in the browser; the administrative area, the linked contact and a chronological ordering are a whole-inventory search. Without a selected listing mode, a price range uses each listing's own asking price; with a selected mode, it uses only that mode's asking price. A contact condition matches through the recorded property↔contact link and applies the same unarchived boundary as the contact directory's linked-property count, so the two never disagree.
_Avoid_: Fixed sale-price basis; "area" for province/ward

**Inventory stream**:
The properties list as one result set, most recently changed first by default - ordered by the record's own modification time, then its identity, so a property somebody edited a minute ago leads the list however long ago it was created - or by the eligible entry-date chronology when that ordering is submitted. The ordinary browse and every filter the loaded catalogue holds the fields for are ordered, filtered and paged in the browser and issue no request, while a whole-inventory search is read from the server as consecutive windows of about a hundred rows. The browser reserves the whole stream's estimated height and keeps only the rows near the viewport in the page. It has no page numbers, no page size and no cursor trail, and the matching total and the rows always come from the same filtered set, so they cannot describe different inventories.
_Avoid_: Numbered page, page-size setting, cursor, partial result set

**Property catalogue**:
The browser's own browsing snapshot of the authorized inventory: property summaries in one stable order - most recently changed first, then the property identity, the same order the list's ordinary browse uses - read through the authenticated catalogue endpoint and held in browser memory, with each property's recorded address variants folded once so typing in the address box narrows them without reading the database. It arrives progressively — every cursor is followed, rows are deduplicated by property identity and indexed as batches arrive — so the first page is searchable before the rest has loaded and an interrupted load keeps what it has and offers Retry. A deliberate refresh builds a replacement catalogue beside the one in use — the working catalogue stays searchable throughout and the replacement's own progress is stated separately — and only a replacement whose every cursor has been traversed and every received row indexed is swapped in, so records that were deleted or became inaccessible are gone; a refresh interrupted while access remains valid keeps its partial replacement for Retry and leaves the previous catalogue and its last successful synchronization time untouched. An authorization failure clears both catalogues until access is re-established, and a successful replacement also renews every catalogue-answered result, while a submitted whole-inventory search keeps its own windows until it is run again. A change the server commits — a save, a create, a merge, a status change, an approval or a lock decision — replaces the affected summary from the server's own answer and reindexes that property's addresses, and such a change is applied over any catalogue read that started before it, so an older answer never overwrites it; a change whose summary the server could not hand back reads the catalogue again instead of keeping a row nothing confirms. It is a browsing aid only — a lock, an approval or an edit always validates against current server state — and a list filtered from it states the loaded properties rather than the whole inventory, never an empty inventory while the load is incomplete._Avoid_: Search cache, offline inventory, authoritative list

**Inventory result view**:
The presentation choice for the inventory stream — cards or table — carried in the properties address beside the search, the ordering and the filters, so switching it or applying a filter keeps the narrowed result set and never changes the read. The summary table groups the recorded facts into property, address, price, area, status, updated time and actions; the full record keeps every source field. The table is not offered at phone width, where cards are the list.
_Avoid_: Second result set, paged view

**Inventory list state**:
What the properties list holds beyond the result set the address names: the text the address box holds (typed, and not necessarily submitted), whether the box was edited at all, and where the stream was scrolled, measured from the stream's own top and left rather than the page's, together with the document's own offset above the stream. It is held in browser memory above the routes for the session as the one list the person left — only the result set they are at is held — so a visit to a property and back restores the list without reading the catalogue again, while a reload of the application starts over. The address still carries the result set itself — the search, the ordering, the filters and the view.
_Avoid_: Second result set, address-carried page number or window offset, persisted list state

**Property quick view**:
The right-hand panel a list row opens without leaving the list: the record's key metadata, the recorded asking prices with the one edit it carries, a comment composer, one attachment through the existing upload path and its limits, and a link into the full detail page for everything else. The asking-price edit is offered exactly where the full record editor is offered and goes through that editor's own write path, so it records the same price, refuses for the same reasons and keeps the same history; it grants no authority the full record does not have. The row is a real keyboard-reachable control; Escape closes the panel and focus returns to the row that opened it.
_Avoid_: Detail page, inline edit, side form

### Vendors

**Vendor**:
A company the inventory works with, recorded as its own directory identity and distinct from an owner, broker, contact or employee. Every active employee may read recorded vendors; only staff, manager and admin roles add vendor directory records, while every active employee may link or unlink a recorded vendor on an unarchived property. The directory slice records the company and its contact block; a separate slice links a recorded vendor to a property, and vendor detail editing remains a further slice.
_Avoid_: Supplier contact, owner type, broker record

**Vendor link**:
An explicit recorded relationship between one property and one recorded vendor. It is not an owner link, a reservation or rental occupancy: it carries no owner-primary marker, no occupancy state and no owner-contact access credit, and a property has at most one link per vendor. The current link row carries its creator and link time; removing a mistaken link keeps the vendor and its other links and does not write Property change history.
_Avoid_: Owner relationship, lock, tenant record

**Vendor contact block**:
The one optional set of recorded contact details belonging to a vendor: contact name, phone strings, email, raw address/source text and notes. Each detail is independently known or unknown, and an unknown detail is never filled with an invented default.
_Avoid_: Required contact, inferred phone, normalized address

**Vendor submission key**:
An employee-scoped key identifying one vendor creation, so an interrupted or ambiguous create retries the same company identity instead of recording another; reusing it with different details is refused.
_Avoid_: Draft identity, duplicate check

### Activity and reservations

**Page view**:
A view of property details by an active employee, including authorized review of an archived property. It is not evidence of a physical visit.
_Avoid_: Visit, attendance

**Personal daily activity**:
An employee's own Page-view event count, distinct properties viewed and Owner-contact access count for one Vietnam business day. It never includes a colleague's activity, and the owner-contact count is not a physical-visit or connected-call count. The same three metrics are reported over an explicitly selected Vietnam date range, where every requested day appears including days with no recorded event, so a period with no activity is explicit zeros rather than a shorter table.
_Avoid_: Company report, visit KPI

**Company employee-by-day activity**:
A manager/admin-only report of every currently active employee's Page-view event count, distinct properties viewed and Owner-contact access count for one Vietnam business day, including employees and dates with no activity. It uses the same metric definitions as Personal daily activity and persists nothing.
_Avoid_: Attendance report, visit report, performance ranking

**Employee owner-contact activity ranking**:
A manager/admin-only order of employees by their total of the Daily owner-contact access counts over a selected Vietnam date range, reconciled to the recorded events, with Page-view events and distinct properties viewed kept separate and never blended into the rank. Every currently active employee appears, a zero total is an explicit row, equal totals share a rank with a stable order, and activity recorded while an employee was active stays attributed to that employee after deactivation.
_Avoid_: Performance score, attendance ranking, composite score, commission ranking, physical-visit ranking

**Province owner-contact activity**:
A manager/admin-only derived table of the same employee-property-Vietnam-day owner-contact units as Company employee-by-day activity, grouped by each property's latest verified primary current province/city with an always-reported Unverified location group for properties whose province cannot be resolved. Correcting or invalidating an address may regroup earlier activity without changing the company total, and it is never a geographic map, a physical-visit count or a performance score.
_Avoid_: Province ranking, geographic map, visit report

**Owner-contact access disclosure**:
A deliberate reveal of a property's recorded owner phone, committed as an Owner-contact access event before the phone is shown. Eligibility comes from the property's recorded owner relationship, and it counts one property per employee per Vietnam day rather than owners, phones or clicks.
_Avoid_: Automatic phone display, call log, attendance

**Confirmed physical visit**:
A reported visit to a property confirmed by an independent reviewer. Submission and independent confirmation are retired in favour of automatically recorded Owner-contact access; retained rows are historical records only, they are never converted into owner-contact credit and no visit review queue exists.
_Avoid_: Page view, legacy click, owner-contact access

**Reservation request**:
A pending claim awaiting independent review. It does not reserve the property.
_Avoid_: Effective reservation

**Effective reservation**:
An approved, unexpired property reservation identifying the claimant for commission attribution, not a commission amount or payout.
_Avoid_: Pending lock, permanent property lock

**Credited closer**:
The one employee explicitly credited with a completed sale. A reviewer selects that employee during confirmation; the property creator, updater, reservation claimant or recorded status never infers it.
_Avoid_: Deal owner, auto-attributed employee

**Sale completion**:
A reviewed logical record that one actual completed sale happened: its property, credited closer, actual Vietnam completion date, contract/reference, confirmer and recording time. It marks the property sold and closes its outstanding reservations without rewriting their attribution. An imported or manually set sold status, an approved reservation and a pending claim are not sale completions.
_Avoid_: Sold flag, general transaction, commission record

**Completed-sale ranking**:
The manager/admin list of effective sale completions grouped by credited closer over a validated Vietnam period, with equal totals sharing a rank and genuinely unknown legacy attribution shown separately rather than assigned to a guessed employee.
_Avoid_: Commission ranking, composite performance score

**Unknown sale attribution**:
A property recorded as sold that has no effective sale completion, so no employee is credited. It is counted separately from the ranking and never becomes an invented closer.
_Avoid_: Unassigned sale, ownerless deal

**Reservation release**:
The audited closure of a pending or approved reservation with a meaningful reason, retaining the original claimant, request reason and every recorded event. It resolves a conflicting claimant before a sale completion; it is neither a completion nor a transfer of attribution.
_Avoid_: Reassignment, deletion of a claim

**Outstanding reservation**:
An employee's effective reservation or pending reservation request that is still open. Employee deactivation makes it visible but never releases, transfers or rewrites it; only the existing claimant/reviewer release or expiry closes it.
_Avoid_: Automatic transfer, reassignment

### Discussion

**Property comment**:
A plain-text message an active employee posts to a property's shared flat discussion. Its author identity and posting time are retained from creation; its author may replace the current text under a revision check, which retains every prior version and marks the entry as edited, and removal withdraws its text while keeping the record.
_Avoid_: Note, activity entry, private message

**Comment edit**:
An author's revision-checked replacement of their own current Property comment on an unarchived property. It keeps the comment identity, author and posting position, changes only the live text, and retains the preceding text as reviewer-only evidence.
_Avoid_: Rewrite, overwrite, new comment

**Comment revision**:
One retained version of a Property comment's text, identified by its edit ordinal. The earliest retained text is the original validated submission, and only an active manager or admin with current property access can read a prior version.
_Avoid_: Draft, replaced comment

**Comment removal**:
The one-way withdrawal of a Property comment's text. An author may remove their own current comment on an unarchived property without a reason; an active manager or admin may remove any current comment with a required moderation reason, including on an archived property, where author removal is blocked. The current discussion shows a removal marker instead of the text, and the text current at removal, author, removing actor, time and reason are retained for manager/admin review. A removed comment can no longer be edited.
_Avoid_: Delete, edit, permanent erasure, comment restoration

**Property discussion**:
The newest-first shared list of a property's Property comments, readable and postable by any active employee who can read the property without holding property-edit authority. A removed comment stays in place as a marker without its text, and an edited comment shows its current text with an edited marker. Posting to an archived property is denied for every role, and only manager/admin read archived discussion.
_Avoid_: Chat, live feed, moderation queue

**Submission key**:
An employee-scoped key identifying one comment submission, so an interrupted or ambiguous post retries the same original comment instead of creating another. Reusing it with a different property, or with text other than the original validated submission, is rejected, including after the comment has been edited.
_Avoid_: Draft identity, temporary ID

**Comment edit key**:
An employee-scoped key identifying one author edit operation. Retrying the same comment, opening revision and validated replacement text recovers that accepted operation without adding another retained version; another use is rejected.
_Avoid_: Comment revision, submission key

**Reviewer-only comment history**:
A manager/admin-only chronological view of a comment's original post, retained edits and one removal event, including each retained actor and Vietnam time. Author withdrawal has no moderation reason; moderated removal retains its reason. The read keeps the 64 oldest events and reports newer events as omitted; ordinary, inactive, unlinked and anonymous callers cannot read it.
_Avoid_: Discussion feed, audit log, retention deletion


### Property files

**Property file**:
A registered document or property photo attached to a property, with a stable identity and original content retained in the private file store.
_Avoid_: Uploaded image, attached document

**Property file limit**:
The per-property ceiling on stored attachments, decided by the file's validated content type rather than its chosen purpose, category or cover choice: at most 5 documents of 20 MiB each and at most 10 images of 5 MiB each, the cover photo counted among the images. A registration reserves its slot before any bytes are accepted; a refused completion releases it to `cleanup_pending` at once and only becomes `failed` once the trusted server has confirmed its bytes deleted, and a registration still pending after 15 minutes no longer counts, so an abandoned attempt never blocks the property for good.
_Avoid_: Storage quota, category limit

**File completion**:
Technical confirmation that the stored content is supported, complete and matches its registration, making it privately available to current property readers. It is not human document review, legal authenticity, ownership certification or malware scanning.
_Avoid_: Document acceptance, review approval

**Signed file URL**:
A short-lived bearer link granting access to an authorized private property file until expiry. It is not a permanent sharing permission or a promise to recall information already delivered.
_Avoid_: Permanent share link, public URL

**Upload recovery**:
Resuming an uploader's original registered attachment after interruption or a new login, using matching local content when no stored object exists. Recovery preserves the original identity and unfinished attempt; different content is a new attachment, not an overwrite.
_Avoid_: Byte-by-byte transfer resumption, orphan cleanup

**Document category**:
A company-wide classification for a Property file. Active employees can create or reuse categories without approval. Each file has one category; Other is the localized default. Custom names retain their spelling in either language, and legacy classifications retain their original meaning.
_Avoid_: Tag, folder, approval level

**Category name**:
A category's name, compared without case or surrounding whitespace while preserving Vietnamese accents as meaningful distinctions. Reusing an equivalent name reuses the category, not a duplicate.
_Avoid_: Accent folding, translated custom category

**Property photo**:
An image attached to represent the property, distinct from an image of a certificate or other document.
_Avoid_: Any image file, certificate photo

**Property cover photo**:
The one Property photo explicitly chosen by a current property editor to represent the property, or no choice. It belongs to that property and has technical file completion; uploading or checking a photo does not choose it automatically. Removing the choice retains the original attachment.
_Avoid_: Public image, automatic first photo, document approval

**Category correction**:
Changing an attachment's one Document category by its original uploader or a current property editor, while the property remains unarchived. It changes classification, not content, file completion, review history, legal status or the property's cover choice.
_Avoid_: Re-upload, document approval, contributor reorganization
