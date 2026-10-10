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

**Employee interface language**:
The employee's preferred Vietnamese or English interface language. It is independent of the language of addresses, source records and signed documents.
_Avoid_: Record language

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

**Record verification**:
An assessment of the accuracy of property facts and contact relationships, distinct from reservation approval. It is not a prerequisite for saving or displaying ordinary inventory changes and does not establish legal ownership.
_Avoid_: Legal approval, address verification

**Address mapping verification**:
A separate evidence-based assessment establishing the property's current administrative units. It is not approval to save an address or reserve a property.
_Avoid_: Record approval, automatic ward conversion

**Correction request**:
A recorded issue or proposed correction by an active employee concerning property facts, addresses, contact details or contact links on an unarchived property. Applying it resolves the request without an approval handoff; submission does not grant editing authority.
_Avoid_: Direct edit, completed correction

**Property change history**:
The record of who changed information affecting a property, when, and its before/after values, including property facts, addresses, contact links and shared-contact details displayed on that property.
_Avoid_: Approval queue, page-view history

### Activity and reservations

**Page view**:
A view of property details by an active employee, including authorized review of an archived property. It is not evidence of a physical visit.
_Avoid_: Visit, attendance

**Confirmed physical visit**:
A reported visit to a property confirmed by an independent reviewer.
_Avoid_: Page view, legacy click

**Reservation request**:
A pending claim awaiting independent review. It does not reserve the property.
_Avoid_: Effective reservation

**Effective reservation**:
An approved, unexpired property reservation identifying the claimant for commission attribution, not a commission amount or payout.
_Avoid_: Pending lock, permanent property lock


### Property files

**Property file**:
A registered document or photo attached to a property, stored in the private `property-files` Storage bucket. Each file has a stable UUID and immutable path.
_Avoid_: Uploaded image, attached document

**File completion**:
Technical validation of the actual stored object: supported content format, registered byte count and SHA-256, and immutable Storage identity. A server-only signed attestation authorizes readiness; browser claims alone cannot. Not human review, legal authenticity or ownership certification. Completed files are readable without a review gate.
_Avoid_: Document acceptance, review approval

**Signed file URL**:
A short-lived bearer link (recommended 60 seconds) authorized by live employee access and property membership. Expired links require a new authorized read; already-issued links cannot be recalled.
_Avoid_: Permanent share link, public URL

**Upload recovery**:
An uploader resumes the original registered file after interruption or a new login. Authoritative Storage presence decides whether to validate existing bytes or reselect matching local content for the same UUID/path. Unknown outcomes are not absence; different or invalid occupied content requires a new attachment, preserving the original registration.
_Avoid_: Byte-by-byte transfer resumption, orphan cleanup

### Property cover photo

**Cover photo**:
An explicit, nullable `cover_file_id` on the property row, set or cleared exclusively through the `set_property_cover` RPC (NULL clears). The RPC is guarded by the existing `private.can_edit_property()`.
_Avoid_: Client-side cover assignment

**Cover eligibility**:
Only a `ready`, validated (`validated_at` not null) photo on the same property is eligible. Legacy ready photos (validated_at=null) are rejected; editors must complete validation first via the existing upload-complete flow. Cross-property files, non-photo files, and uncompleted uploads are rejected.
_Avoid_: Auto-validate-and-set

**Cover guard**:
The `property_cover_guard` trigger (invoker, before INSERT or UPDATE) blocks direct cover_file_id changes by authenticated callers. The definer RPC sets `app.cover_authorized` before the UPDATE to authorize the change. Clients cannot forge the variable.
_Avoid_: Direct column mutation by client code

**Cover display**:
The cover image is fetched via the existing signed-URL endpoint for the referenced file. The workspace shows the cover with set/clear controls for editors; the inventory card shows a thumbnail or neutral placeholder. The detail page includes cover display in the workspace section.
_Avoid_: Separate cover upload endpoint
