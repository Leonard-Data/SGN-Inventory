# Approval, employee activity and access

## Role matrix

| Capability | Sales | Staff | Manager | Admin |
| --- | --- | --- | --- | --- |
| Read internal inventory, addresses, contacts/files and employee directory | Yes | Yes | Yes | Yes |
| Read the vendor directory | Yes | Yes | Yes | Yes |
| Create vendor directory records | No | Yes | Yes | Yes |
| Link or unlink a property's vendor | Yes | Yes | Yes | Yes |
| Create property / request reservation | Yes | Yes | Yes | Yes |
| Edit property/address | Own unarchived | All unarchived | All unarchived | All unarchived |
| Correct an existing linked shared-contact detail | Yes | Yes | Yes | Yes |
| Correct an unlinked shared-contact identity | No | Yes | Yes | Yes |
| Create contacts, change relationship/primary markers or unlink | No | Yes | Yes | Yes |
| Submit correction request | Yes | Yes | Yes | Yes |
| Process/reject correction requests | No | Yes | Yes | Yes |
| Record own page view / owner-contact access | Yes | Yes | Yes | Yes |
| Read daily activity | Own | Own | All | All |
| Approve/reject lock | No | No | Another employee only | Another employee only |
| Set legal/review state | No | No | Yes | Yes |
| Merge properties that share an address (archives the folded records) | No | No | Yes | Yes |
| Confirm a completed sale (another employee's credit) | No | No | Yes | Yes |
| Read the completed-sale ranking | No | No | Yes | Yes |
| Manage employee activation/roles and catalogs | No | No | No | Yes |
| Deactivate a linked employee (guarded; provider block confirmed) | No | No | No | Yes |
| Invite an employee by email and role (guarded; provider request recorded) | No | No | No | Yes |
| Open the admin employee list (`/people/employees`) | No | No | No | Yes |
| Read area/employee analytics | No | No | Yes | Yes |
| Read staging/audit directly through API | No | No | No | No |

These roles are company-wide. Every active employee, Sales included, may read the vendor directory and link or unlink a recorded vendor on a property they can read. Staff, manager and admin create vendor directory records; vendor editing is ticket #75's work. No team isolation is assumed. The directory includes work emails and employee phones; treat these as internal data.

## Reservation lifecycle

```mermaid
stateDiagram-v2
  [*] --> Pending: Employee requests
  Pending --> Approved: Independent reviewer
  Pending --> Rejected: Reviewer rejects
  Pending --> Released: Owner or reviewer cancels
  Pending --> Expired: 48-hour expiry
  Approved --> Released: Owner or reviewer releases
  Approved --> Expired: Approved term ends
  Pending --> ClosedBySale: Confirmed sale completion
  Approved --> ClosedBySale: Confirmed sale completion
```

A rejected/released/expired request is terminal; a later claim is a new request. Approved is effective only while `expires_at > now()`. Pending requests are visible for review and do not reserve the property. Competing pending requests are allowed; approval serializes on the property row, then checks the partial unique index. The database forbids self approval, even for admins.

Reviewers inspect the deal reason, customer agreement evidence and claimant, then record a decision reason. The reference/evidence links are commission-attribution evidence only. Advertised sale price is not an agreed deal value or a commission basis. Selling an inventory record is not ordinary maintenance: an eligible manager/admin other than the credited employee confirms an actual completed sale — property, explicitly selected credited closer, actual Vietnam completion date and contract reference — which marks the property sold and closes open reservations as `closed_by_sale` with retained claimant and events. An activated rental blocks it; an effective reservation of another employee must be resolved through the audited release first. The completion is the only route to a sold state, and `sold`/`rented` flags, approved reservations and pending claims alone never earn completion credit.

Each transition writes a lock event and an audit snapshot. Expired rows are cleaned lazily when a reservation RPC operates on the same property. Dashboards always use effective locks, so expiry is correct even before cleanup. A scheduled sweeper is optional; if added, acquire the property lock first and append expiry events. Do not let a stale approved row block an approval without expiring it within the same transaction.

Deactivation disables internal membership first and confirms the exact Auth sign-in block through the server-only adapter; a failed or ambiguous provider result stays a recorded reconciliation state and never claims completed deactivation. The departing employee's outstanding reservations stay attributed to them: the control makes their existence visible, and the existing claimant or reviewer may release them or let them expire. Nothing is transferred automatically and the historical claimant is never rewritten. Existing short-lived file links remain bearer links until expiry, so the application should keep their lifetime short.

## Employee activity and daily KPIs

| Metric | Definition | Interpretation |
| --- | --- | --- |
| Page view events | Every logged detail-open event | Interaction count; reloads can increase it |
| Distinct properties viewed | Unique property UUIDs per employee/Vietnam day | Better inventory activity measure |
| Owner-contact properties | Distinct properties whose recorded owner phone was deliberately disclosed per employee/Vietnam day | Disclosure count; not calls, owners or physical visits |

Legacy `clicks` is imported as `page_view`/`legacy_click`. It never becomes `site_visit` merely because the sheet contains “Ngày xem”. New events use the server time of submission, with an employee-scoped UUID retry key. Physical-visit submission and confirmation are retired; retained `site_visit` rows keep their original attribution, day and status, and the MVP still supports no backdated visits.

The daily view has rows only for days with recorded events. Reporting over a selected range crosses a Vietnam date calendar — the caller's own personal report and company admin reporting for every currently active employee — so requested days with no events appear as explicit zeros; a deactivated employee's historical events are not listed there, while the delivered rankings keep a deactivated contributor's recorded total (`docs/database-contract.md`). “Active employee” on a day means at least one tracked view or owner-contact access according to the displayed metric; it is not proof of attendance, employment hours or GPS presence.

## Rental and localization extension

The required languages are VI/EN, with Vietnamese regional conventions in either UI. Staff/managers/admin maintain rental drafts and payment submissions. Manager/admin independently activate leases and confirm/reject/void another employee's receipt/refund. Sales can view tenancy/occupancy status but not rental payment details. Monthly dues, paid balance and overdue/refund states are derived from confirmed payments. See `rental-localization-contract.md`. Commission payout remains outside scope.

## Database and file security

- RLS and explicit grants apply together to exposed tables. `anon` has no inventory access.
- Authorization uses a live active employee row, independent of editable Auth profile metadata.
- Business mutation definers are private, fixed-search-path functions with explicit role checks; public endpoints are invoker wrappers.
- Views are invoker views; private staging and audit tables have RLS and no client grants.
- Property file bytes live in a private R2 bucket reached only through 60-second presigned URLs. The RLS-checked `property_files` record is the read authority: a pending registration accepts one signed upload URL, and a ready object is readable only by an active employee — or an archived property's reviewer — after that record is authorized. The four `R2_*` values are server-only; a missing one fails file operations closed.
- Browser file overwrite and deletion are refused: the browser only holds a 60-second signed upload URL whose signature covers the object key, the registered byte count and the `If-None-Match` conditional create, so R2 refuses any other body length and refuses to replace an existing object; a refused upload's row is released to `cleanup_pending` at once, and only the trusted server deletes the bytes and then records `failed`. No client session can claim the bytes are gone, the deletion is retried by a server cleanup pass until it succeeds, and no browser path deletes a ready file. Completion re-reads the object from R2 and signs an attestation over its size, hash and decoded format that the database verifies. Document review stays reviewer-only.
- UI hidden controls improve usability; database policies remain the authority.

## Operational controls to implement

Validate every form and server input. Require POST/Server Action mutations with origin/CSRF protections appropriate to the route. Limit high-volume search/event submissions in application middleware or an equivalent rate limiter. Prevent shared caching of signed-in data. Keep logs limited to request IDs, error classes and safe identifiers. Alert on repeated reservation conflicts or failed file completions without logging deal/contact content.

Admin user invitations must link the correct Auth account to an employee email and confirm the requested role. The last active admin is protected by a database trigger that refuses a deactivation, demotion, unlink or removal that would leave the company without an active admin, serialized with an advisory lock so concurrent removals cannot both pass; deactivation runs through the guarded `begin_employee_deactivation` RPC and a direct lifecycle, link or role write cannot bypass the guard. An invitation runs through the guarded `begin_employee_invitation` RPC: it records one normalized address and one existing company role under the live admin, creates the invited employee unlinked and inactive, and records the provider request state without activating or linking anyone; the requested role is never written into editable Auth metadata. Only the invitee's own session accepts it: the public invoker `accept_employee_invitation` requires the caller's `auth.uid()` to be the invitation's recorded provider identity, so an email match alone, a different identity, an arbitrary redirect, password recovery or edited Auth metadata never links, activates or promotes anyone, and the recorded role is the one that applies. A valid, current, correctly matched invitation completed by that invitee links and activates the retained employee immediately — the invitee activates themselves, with no manager approval step — while a deactivated, deleted or differently-linked employee is refused and never restored. Admin row actions that activate or change a role remain unshipped. Bootstrap the first admin through a controlled administrative database action after creating the Auth account.
