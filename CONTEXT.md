# SGN inventory domain

One company's shared property inventory, employee access, contacts, reservations and rental records.

## Language

### Employees and access

**Employee invitation**:
An offer to join the company's internal inventory. Acceptance alone does not establish active employee access.
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
An employee record with no confirmed sign-in identity. It is a distinct access state, not a pending invitation, a disabled account or a deleted person; the schema records no invitation.
_Avoid_: Invited employee, deleted employee

**Employee interface language**:
The employee's preferred Vietnamese or English interface language. It is independent of the language of addresses, source records and signed documents.
_Avoid_: Record language

**Employee deactivation**:
The controlled disabling of a linked employee's company inventory access, completed only after the exact sign-in block is confirmed by the sign-in provider. Membership is disabled first and an unconfirmed provider result stays a reconciliation state, not a completed deactivation.
_Avoid_: Access patching, account deletion

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

**Contact**:
A shared named party whose contact details may be used by several properties. Its relationship to each property is recorded separately as a property contact link.
_Avoid_: Property-specific phone record

**Shared-contact detail correction**:
A correction of the identity details of an existing linked Contact by any Active employee who can read the property it was opened from. It commits immediately and appears in the change history of every Property linked at that moment, and it is separate from Property-fact authority: it does not create, link, unlink or merge contacts.
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
The record of who changed information affecting a property, when, and its before/after values, including property facts, addresses, contact links and shared-contact details displayed on that property.
_Avoid_: Approval queue, page-view history

**Asking-price history**:
A property's recorded sale asking prices and monthly asking rents, presented as separate newest-first series with the actor, Vietnam time and before/after whole-VND values of each saved change. An unknown value is a gap and a recorded zero stays zero; an untouched amount never appears as a change. Achieved sale prices, contractual rent, monthly dues and receipts are not part of either series, and no earlier price is invented.
_Avoid_: Market valuation, price list, achieved price, projected price

**Correction explanation**:
An optional retained note an authorized editor attaches to a recorded price correction. It stays with the revision it explains and never replaces the mistaken value, deletes earlier history or creates an approval step.
_Avoid_: Approval reason, price justification, replacement value

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

**Owner-contact access disclosure**:
A deliberate reveal of a property's recorded owner phone, committed as an Owner-contact access event before the phone is shown. Eligibility comes from the property's recorded owner relationship, and it counts one property per employee per Vietnam day rather than owners, phones or clicks.
_Avoid_: Automatic phone display, call log, attendance

**Confirmed physical visit**:
A reported visit to a property confirmed by an independent reviewer.
_Avoid_: Page view, legacy click

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
A plain-text message an active employee posts to a property's shared flat discussion. Its author identity, text and posting time are retained from creation; a comment is never edited, and removal withdraws its text while keeping the record.
_Avoid_: Note, activity entry, private message

**Comment removal**:
The one-way withdrawal of a Property comment's text. An author may remove their own current comment on an unarchived property without a reason; an active manager or admin may remove any current comment with a required moderation reason, including on an archived property, where author removal is blocked. The current discussion shows a removal marker instead of the text, and the original text, author, removing actor, time and reason are retained for manager/admin review.
_Avoid_: Delete, edit, permanent erasure, comment restoration

**Property discussion**:
The newest-first shared list of a property's Property comments, readable and postable by any active employee who can read the property without holding property-edit authority. A removed comment stays in place as a marker without its text. Posting to an archived property is denied for every role, and only manager/admin read archived discussion.
_Avoid_: Chat, live feed, moderation queue

**Submission key**:
An employee-scoped key identifying one comment submission, so an interrupted or ambiguous post retries the same original comment instead of creating another. Reusing it with different property or text is rejected.
_Avoid_: Draft identity, temporary ID


### Property files

**Property file**:
A registered document or property photo attached to a property, with a stable identity and original content retained.
_Avoid_: Uploaded image, attached document

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
