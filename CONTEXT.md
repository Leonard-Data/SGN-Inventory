# SGN inventory domain

One company's shared property inventory, employee access, contacts, reservations and rental records.

## Language

### Employees and access

**Employee invitation**:
An offer to join the company's internal inventory, recorded against the intended employee and address. Acceptance by that intended invitee links and activates the retained employee immediately, with no separate approval.
_Avoid_: Access approval

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
The seeded official province/city and commune/ward list carrying official codes, parent links and one half-open validity window per official name from the pinned upstream dataset. It is a reference list for selection and hierarchy validation, not a property's verified address; a renamed unit reports the name in force on the address date.
_Avoid_: Verified address, property-level mapping

**Address search**:
A match of a literal, accent-insensitive contiguous fragment against recorded addresses; `%` and `_` are ordinary characters.
_Avoid_: Fuzzy search, automatic ward mapping

**Unresolved address mapping**:
A legacy-to-current address relationship without sufficient reviewed evidence to identify the current administrative units.
_Avoid_: Verified match

**Property contact link**:
The recorded relationship between a property and a contact, such as owner or broker. Several contacts may belong to a property, with at most one marked primary.
_Avoid_: Contact inferred from sheet position

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
The record of who changed a Property's asking price, when, and its before/after values. Only recorded asking-price changes add rows; creation, address, contact, link, note and status changes are not recorded here — they are attributed instead in the private audit trail with the actor, time and before/after values, subject to that trail's own 90-day retention window, deliberately not the permanent record this history would have been — and rows recorded before this rule was applied are retained and stay readable.
_Avoid_: Approval queue, page-view history

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
The optional conditions used to narrow inventory by status, listing mode, property type, price, land or floor area in square metres, the administrative area of an address (province/city and its dependent commune/ward; the narrower ward governs when both are selected), or a recorded contact linked to a property. Without a selected listing mode, a price range uses each listing's own asking price; with a selected mode, it uses only that mode's asking price. A contact condition matches through the recorded property↔contact link and applies the same unarchived boundary as the contact directory's linked-property count, so the two never disagree.
_Avoid_: Fixed sale-price basis; "area" for province/ward

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
