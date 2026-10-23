# Release notes

What has shipped, newest first, and why it matters to someone using the inventory.

Every entry is dated by the day the work reached the default branch. The project has no tagged
release yet (`package.json` is `0.2.0`, no GitHub release or version tag exists), so these notes are
grouped by date rather than by version number. A number in parentheses identifies the tracking issue
or the pull request that delivered the change, on
<https://github.com/Leonard-Data/SGN-Inventory>.

Each entry names the behaviour that changed and the gap that came with it. Every feature listed as
shipped is implemented in the code on `main`; where a real-browser or hosted acceptance run has not
executed, that is stated in the entry rather than left implied. Correspondence between a feature and
what was *verified* is in [testing.md](testing.md).

## 23 October 2026 — the properties table orders and hides by column

### A table header orders the whole list, and a column can be hidden

The properties table's headings now order the list. Price, total area, frontage, depth, status and
last changed each turn their heading into a button that cycles ascending, descending and back to the
default browse, carrying the active direction as `aria-sort`, and a Columns control above the table
hides or shows any column but the property code and the actions — a hidden column loses its heading
and its cells together. Both choices travel in the properties address beside the search, the view
and the filters, so a reload or a shared link keeps the table the person shaped, and hiding a column
leaves their place in the same rows.

The read behind the ordering is the same `stream_inventory` call the list already made: the server
accepts one order key per sortable column and direction beside the two entry-date orderings, sorts
records that state no value last in both directions, breaks ties on the property identity and orders
status by the workflow its states progress through rather than alphabetically, so consecutive
windows neither repeat nor drop a row. A column ordering is the ordinary unarchived browse
reordered, so it keeps that browse's statuses and its RLS boundary; only the entry chronology stays
the eligible-status, employee-only view, and an order the read does not know is still refused.
Stating an order also fixes a filter that used to be answered from the loaded rows alone: a header
sort applied while "created by me" is active now returns only that person's records in the requested
order, because the whole-inventory read gained that criterion and the panel's creator field is no
longer locked for an advanced run.

_Why it matters:_ getting a truthful order across 18.8k records was previously possible only by
choosing the entry-date chronology or scrolling the default browse. A salesperson can now ask "what
is the cheapest available stock", "what is largest" or "what has been sitting untouched longest"
and get the whole filtered inventory in that order, sharing the address that states it.

_Known gap:_ the header ordering, the Columns control and the creator criterion have unit and
embedded schema coverage only. No signed-in browser has exercised the header cycle, the column
toggles or a shared address at any width, and the migration replacing the read has not been applied
to the development project, so the real Data API call and the interaction remain staging gates in
[testing.md](testing.md#inventory-table-header-ordering-and-hidden-columns).

## 22 October 2026 — the inventory opens on what changed most recently

### The list's first window is the most recently changed inventory (#258)

The properties list now opens on the record's own latest change instead of its creation. The order
is the change time then the property identity — `updated_at desc, id desc` — where the change time
is what `private.guard_property()` stamps on a property write and what
`private.record_business_change()` moves on the parent row when an address, mapping or contact
changes, and the identity is the tie-break that keeps one total order over the whole
filtered set. A property somebody edited a minute ago leads the list however long ago it was
created, so the imported stock — all created inside one import run — no longer buries every later
correction under its own import position. The entry-date chronology is unchanged and is still chosen
in the filter panel, whose default order option now names the change order in Vietnamese and
English instead of the creation order it no longer describes.

The browser catalogue reads in that same order, so the first page painted is the inventory's first
window and a list answered locally from the loaded rows agrees with a server window on what belongs
at the top. The migration adds one partial index over unarchived rows for the catalogue's page read;
the whole-inventory read still sorts the set it materialises for its matching count, so that read's
cost at the current size is unchanged.

_Known gap:_ the browse key is mutable, and the ordering pays for it. A record edited while a
catalogue load is walking the pages can be missed by that traversal — and so by every local search
over the loaded rows — until the next refresh, and an edit that lands while someone is scrolling the
whole-inventory windows can show one row in two consecutive windows and hide another, because the
stream keeps each window by offset and does not dedupe across them. Both are accepted rather than
fixed, since removing them needs a snapshot-capable read. The order, the cursor keyset and the local
ordering have embedded schema and unit coverage only, and the plan was measured in embedded
PostgreSQL at the imported stock's size: no real-browser or hosted Supabase run has exercised the
new first window.

## 21 October 2026 — the inventory list answers from the browser

### The catalogue answers the list, and the database answers only what it cannot (#188–#194)

The properties list no longer reads the database to filter itself. The browser holds a compact,
user-scoped catalogue of the authorized inventory — summary fields only, one page at a time through
`GET /api/properties/catalogue` on the caller's own session client, so Row Level Security still
decides every row — and the search box, the status, listing-mode, type, asking-price and area
filters, the result paging and the newest-created ordering are computed over those rows in the
browser, issuing no request at all. The slices landed on `main` on 20 and 21 October; this entry
covers them as the one change a person using the list experiences.

With it:

- **Progressive loading with honest progress** (#189). After the first page the loader follows the
  endpoint's own cursor to the end of the authorized inventory, deduplicating and indexing each
  batch, and a line beside the search stated the loaded count, the authorized total and an
  approximate percentage — held below 100% until the last batch is indexed — or the loaded count
  alone when the total was not known. That progress line is gone: #267 removed it, leaving Refresh as
  the only loading affordance, so the loaded count now appears only as the denominator of the address
  box's own local match line. An interrupted load keeps what it has and offers Retry, and while it is
  incomplete an empty result reads as "no matches in the loaded properties", never as an empty
  inventory.
- **Deliberate Refresh as a replacement catalogue** (#190). Once the catalogue is complete, Refresh
  builds a replacement beside the one in use: the working catalogue stays searchable throughout, the
  replacement states its own progress and total separately, and it is swapped in only when every
  cursor has been traversed and every received row indexed — so deleted or newly inaccessible
  properties disappear. A stopped refresh keeps the previous catalogue, its last-updated time and
  its rows, and offers Retry.
- **Vietnamese matching that respects house numbers** (#191). Matching folds accents, `đ` and case,
  expands the controlled abbreviations (`P.`, `Q.`, `TP.` and the rest) and treats a house number as
  a structure rather than a substring, so 12 does not find 112 or 12A, 12A keeps its letter, and
  12/5 stays an alley under 12. Each stored address variant is searched on its own, so a query can
  never match an old district against a current ward, and the ranking runs from the exact recorded
  address down to the loosest prefix match. A recorded property code is matched beside the address —
  in full, which ranks first, or as a fragment at the loosest rank — because the database's own
  search matches both fields.
- **The list survives a property visit** (#192). Opening a property and coming back restores the
  text in the box (typed and never submitted, so it was never in the address), the filters, the
  ordering, the view and the position in the list, without reading the catalogue again; a reload of
  the application starts over.
- **A committed change updates the list from the server's own answer** (#193). A saved edit, a create,
  a merge, a status decision or an applied correction answers with the affected property's summary
  read back from the server after it committed, and the browser applies that answer over the
  catalogue instead of merging the submitted values into the loaded rows, so a page or a refresh that
  started before the change cannot overwrite it. The rows follow the server: a confirmed change re-reads the list's own
  windows where the list is drawn from them, and a lock or approval refusal that means the committed
  state moved on makes the panel re-read the property. Locking and approval remain the database's
  decision, and the cached status never authorizes either.
- **Local filters and the advanced-search split** (#194). Status, listing mode, type, the
  asking-price and area ranges and the typed address or property code are answered from the loaded
  rows; the province/city and commune/ward selects, the linked contact and the original entry-date
  ordering are a whole-inventory search the person runs from the filter panel, because the summaries
  carry no field for them — and that ordering is also the narrower `available`/`negotiating`
  database view rather than a reordering of the loaded rows. Editing a control runs nothing; only
  running the panel reads. The panel names its action "Run advanced search" when that is what it
  will do, the list states which of the two answered it, and an advanced page is cached under its own
  key (account, submitted criteria, ordering and page) with a bounded lifetime separate from the
  catalogue's. A typed text the browser matches nothing for states the fields it did match and
  offers the whole-inventory search for that text instead of leaving an empty local answer.

_Why it matters:_ searching and filtering the inventory used to be database reads, and a remount or
a return from a property read the same rows again. The list now answers from memory, and the reads
that remain are the ones a person asks for. Just as importantly, the label on the result says what
was really searched: a locally filtered view of the loaded properties is never presented as a search
of the whole inventory, which is what people make decisions on.

_Known gap:_ all of it is verified by unit and embedded tests, not by a browser. These lanes had no
browser and no hosted Supabase, so the absence of a request per keystroke, the reused advanced page,
the restored position, the post-swap and post-commit rows and the VI/EN rendering all remain
staging gates in [testing.md](testing.md). Two things are worth stating plainly: no slice of this work
was exercised in a real browser before it was reported done, and the review rounds that followed
found defects — a failed first read of an advanced search that rendered nothing, a view switch that
could restart a submitted search after it had been idle, and notes that named fields the browser
already matches — after earlier rounds had reported the work clean.

## 20 October 2026 — a rewritten README, a release record, and three directory defects

### The README describes the application that exists, and these notes begin (#183, #184)

The repository's front page no longer introduces a 10 October foundation package. It states what the
product is and who uses it, what each page and area does, the stack at the versions this repository
actually pins, the minimum configuration a deployment needs — three resources and every environment
variable, named with what breaks without each one — local setup and verification, the data model and
where it lives, and the limits that are still real. The measured R2 volume is recorded there: 2,220
objects, 587.3 MiB over 1,034 distinct property prefixes, largest object 2,041,894 bytes, listed
read-only from the configured bucket with the repository's own client. So are the production row
counts and the **154 MB** database size the operator measured on 20 October, after the import staging
archive was pruned (narrated in the 19 October entry below).

These notes were added in the same change, so everything shipped through 19 October now has a dated
entry naming the behaviour it delivered and the gap that came with it, instead of surviving only in
pull requests.

_Why it matters:_ the document a reader meets first described an application that no longer exists,
and a deployer had no single place stating which configuration actually has to be present for the
app to run.

_Known gap:_ the production figures are the operator's 20 October measurements relayed into the
document. That documentation run had no database credentials and the Data API refused an
unauthenticated read, so the database figures were not re-measured; the queries that reproduce them
are given beside the README's table, and it lists the acceptance gates that remain outstanding rather
than implying they passed.

### Three directory defects closed: one header, a stacked access cell, a reserved window skeleton (#182, #185)

Three defects reported after the UI pass went live were fixed on the employee and contact
directories. `/people/employees` rendered its page header twice — the house eyebrow block and the
block carrying both the heading the panel is labelled by and the invite toolbar — and now renders one
header, in every state the page can be in and in both languages. The access column kept its 210px
desktop minimum inside the stacked phone row, so a row carrying several badges measured 613px inside
a 360px wrapper and the page scrolled sideways; at phone width the cell now releases the width and
its badges wrap between each other, while a badge's own label still never breaks mid-word and the
desktop column keeps its width and appearance. Scrolling either directory also under-reserved the
window about to arrive, so the loading effect was a stub of one to seven rows inside mostly blank
reserved space and the list looked finished while it was still reading; each directory now passes the
read length it pages with, so every chunk the arriving window fills is reserved and replaced by
exactly the rows that land on it — the behaviour the properties list already had, through the same
machinery. A window that resolves immediately still paints nothing.

_Why it matters:_ the duplicated header and the sideways-scrolling phone row are what a person on a
phone actually saw, and a skeleton that understates how much is still coming reads as a list that is
empty or already complete.

_Known gap:_ the fix was driven in headless Chromium at 1440×900 and 375×800 in both languages, but
that lane had no authenticated session, so it mounted the real directory components against a stubbed
API in a temporary route deleted before the commit. A signed-in load of `/people/employees` and
`/people/contacts` against the development database — the real payloads and the RLS path behind them
— has not been observed.

## 19 October 2026 — one inventory stream, status decisions, and the directories

### The inventory list is one streamed result set (#154–#157, #162–#164, #168–#170)

The properties page no longer paginates. It reads everything the filters match, ordered by the server
(newest-created first by default, or the original entry-date chronology), window by window of about a
hundred rows as the page scrolls. The matching total comes from the same read that answers each
window, so the count and the rows can never describe different inventories. Only the rows near the
viewport stay mounted, which is what keeps 18.8k properties usable in one list.

With it:

- A **table view** with the ten requested columns (property ID, created date, price, status, house
  number, street, ward, district, total area m², modified time), price emphasised in tabular
  numerals and a missing value as an em dash. Cards or table travels in the address, so switching
  keeps the search, ordering and filters. Neither view has a page number, page-size setting or cursor
  trail.
- A **row quick view** — the right-hand drawer a row opens by click, Enter or Space: key metadata,
  the status control, a comment box that posts without a reload, one attachment through the normal
  upload path and its per-class limits, and a link into the full record. Escape closes it and focus
  returns to the row that opened it. The drawer is not an edit form and grants no authority the
  record does not have.
- The **properties page opens in table view**, with an icon-only Cards/Table switch and a skeleton
  per incoming window rather than a spinner.
- The **table is not offered at phone width**, where cards are the list; and a stored cover
  photograph, if any, wins over the drawn site plate.

_Why it matters:_ the previous numbered pager (shipped 18 October, #140/#146) could not express "show
me more of this result set" the way scrolling does, so it was retired in this change and its
rationale recorded in [adr/0002-inventory-list-stream-and-table-view.md](adr/0002-inventory-list-stream-and-table-view.md).
The database read for the old pager still exists but is unreferenced.

_Known gap:_ the stream is verified by embedded and unit tests; the real-browser gates for the newest
head (keyboard-only and 360px review, and a hosted walk-through of the drawer's upload path) have not
all been re-run since.

### Property status is recorded on its own trail, and sold/rented is a manager's decision (#173, #174)

Every status change now appends a row to a retained trail on the property: who changed it, the status
it left, the status it reached, the Vietnam time and the note they typed. `draft`, `available`,
`negotiating` and `withdrawn` can be applied by any active employee. `sold` and `rented` can only be
applied by a manager or admin — anyone else raises a **request**, at most one per property, and
`/reviews/status-requests` is where a manager or admin approves or rejects it with a required reason.
A decided request stays readable in the record's own trail rather than vanishing from the queue.

_Why it matters:_ previously a status was just a field someone edited, with no record of who moved it
or why, and no way for a non-manager to propose a final state without holding edit rights for it. A
sold status set this way is **not** a completed sale: the sale-completion confirmation (#38) is still
the only route to one, and the completed-sale report keeps counting a sold record with no completion
as unknown attribution rather than crediting somebody.

_Known gap:_ the trail is enforced and tested in the embedded schema harness; the development-project
journey (change a status as a non-reviewer, read the trail back, confirm the ranking is untouched) is
still a staging gate, because no migration has been applied to a hosted project from that
environment.

### Employee and contact directories load as you scroll, and edit in a drawer (#176–#178)

The streamed list was extracted so the employee and contact directories read it too: they now load
more rows as you scroll instead of stopping at a first page. Editing moved into the same guarded
drawer pattern on both directories, and the inventory table got its typography, density and
single-scrollbar polish.

_Why it matters:_ the directories are the place an admin or staff member actually corrects data, and
scrolling plus in-place editing removes the trip that used to be needed just to change a name or a
phone number. Editing still runs through the same guarded endpoints as before — the drawer is a
surface, not a new authority.

### Employees can be edited, and people can write their own name and bio (#152)

An admin can change a colleague's recorded name, phone, role and bio from the employee directory as
one deliberate action that reports what changed; a role change records which admin made it. On
`/profile`, the signed-in person sets their own display name and bio (a plain line, at most 280
characters) and nothing else — phone, role and email stay admin-edited.

### Invitation fixes (#158, #159)

An admin can send a **recorded invitation again** when the link expired or the message was lost,
without creating a second person or a second invitation. The invitee's own setup journey also had a
real defect on the trusted-server path: the two tables it reads were not readable by that server
client, so a genuine invitee was refused with an access-denied error. The forward migration
`20261019052936_employee_admin_trusted_read.sql` grants `select` — and only `select` — on those two
tables to the trusted server; `anon`, `public` and ordinary employees gained nothing.

_Known gap:_ a delivered invitation link still lands on the project's Auth Site URL rather than the
fixed `/auth/invite` path until the application origin is added to the project's Redirect URLs allow
list. That is a project-owner configuration change, not a code change; the journey recovers the
delivered session from the provider's own redirect chain in the meantime.

### Company activity report grouped by employee (#143)

The manager/admin company report groups its daily history by employee, so one person's Vietnam-day
activity reads as a block rather than as rows scattered through a date-ordered table.

### The legacy workbook import was executed into production (#151 and the run itself)

The same snapshot imported into the development project on 18 October was written into the production
Supabase project: **18,801 properties** (all `record_review_status = pending`), 18,801 preserved
legacy addresses and 18,510 converted current addresses, **8,078 distinct owner contacts** over 8,444
recorded links, **2,220 ready files** (587 MiB over 1,034 properties) stored in the private R2 bucket
through the application's own registration and completion RPCs, 18,587 `Historical` rows archived in
the import's private staging table, and **35 employees** with **33 recorded invitations**.

_Why it matters:_ the inventory is now real, with every imported row traceable through
`private.property_source_map` to its workbook row, and nothing approved or finalised by the import:
every property starts pending review.

_Known gaps inside this run:_ the official address reference (`provinces.open-api.vn`) timed out on
every request from that environment, so 266 rows are counted as
`official_reference_unavailable` and 291 imported properties keep a legacy address only and still
need review — nothing was guessed to fill either gap. The run also reproduced two transport faults
and recovered by **resuming**, never by reseeding: the link reset roughly half of the first pass's
attempts, and an expired Drive token lost 326 downloads in the second pass, which the third pass
recovered with zero failures. The production write stage is now pinned in the script and refuses to
write to another account's bucket (#151), so a mislabelled environment file cannot retarget it.

_Later, on 20 October 2026, that project's import staging archive was **pruned**._ The staging table
(41,484 rows / 68 MB) and the provenance map that pointed at it (39,608 rows / 7.7 MB) held import
scratch the application never reads, so removing them changed no application behaviour and reclaimed
75 MB of the database (229 MB → 154 MB). The rows were archived gzipped outside the database before
deletion — 41,484 rows, 4.1 MiB, read back line by line — and the property-to-source-key map was
deliberately **kept** (18,801 rows, 5.2 MB), so every imported property is still traceable to its
workbook row. What that leaves is an audit trail at 82 MB whose 90-day trim is defined but not
scheduled, so the trail grows without a ceiling until an operator runs the trim.

## 18 October 2026 — private storage, the first real import, and duplicate addresses

### Property files moved to private Cloudflare R2 (#133)

File bytes left Supabase Storage for a private R2 bucket, reached only through 60-second presigned
links minted **after** the RLS-checked `property_files` row is authorized. Per-property class limits
are enforced by the database: at most 5 documents of 20 MiB and 10 images of 5 MiB, the cover counted
among the images; an upload is a signed `PUT` whose signature covers the object key and the
registered byte count and requires a conditional create, so R2 itself refuses a body of any other
length and never replaces an existing object. The app server never streams file bytes. A refused or
abandoned upload releases its slot and is retried by a server-side cleanup pass until the bytes are
confirmed deleted — no browser path can delete a ready file.

_Known gaps:_ there is **no fallback to Supabase Storage** — a missing or partly configured R2
setting fails file operations closed with an opaque `503`, and completing an upload additionally
needs `SGN_FILE_VALIDATION_KEY` installed in both Vercel and the matching private database row. The
quick-upload round trip in the row quick view cannot complete on a deployment without R2. The
one-off copy of existing objects from the retired Supabase bucket (`scripts/copy-property-files-to-r2.mjs`)
is dry-run by default and has not been run against a hosted project.

### The legacy import was executed into the development project (#145)

The same run described above first landed in the development project: 18,801 properties, 8,078 owner
contacts over 8,444 links, 2,220 files, 18,587 archived historical rows, and 32 recorded invitations,
with 483 master rows quarantined or excluded and every count named by reason.

_Known gap:_ property, address and contact rows were written over the administrative (owner)
connection, so row-level security was **not** exercised for them; the attachments did go through the
application's own RPCs as the importing admin and were subject to the shipped limits.

### Invitation acceptance journey (#69, #131, #137, #138, #129)

An invited person now completes setup themselves: the delivered link establishes the session, they
set a name and password, and the database links and activates **the recorded employee** with the
recorded role — no separate approval and no email-match shortcut. Invitations open in a dialog, an
invitation token body can establish the invite session without origin evidence (#137), and a retry
after the provider already holds the address is reconciled rather than recorded as a failure (#129).

_Why it matters:_ the invitee is the only person who can activate their own record, and an email
match, edited Auth metadata, password recovery or a different signed-in identity can never link,
activate or promote anyone.

_Known gaps:_ the acceptance journey passed its hosted run (see the trusted-read fix above); a real
browser landing on `/auth/invite` still needs the origin allow-listed. The provider-refusal recovery
path is covered by embedded sequence tests only — it has not been observed against the real Auth
administration API.

### Contacts: find properties by a linked contact, and staff can correct an unlinked identity (#128, #130)

The inventory filter set gained a recorded-contact condition, read through the same link boundary the
contact directory counts, so the two never disagree, and each directory row states its unarchived
linked-property count — including an explicit zero. Staff, manager and admin can also correct an
identity that has **no** property link; sales keeps the linked-only editor.

### Duplicate addresses can be seen and merged (#147, #148)

Properties sharing the same normalized primary address text are listed as a group on the record, and
a manager or admin can deliberately merge the others into the most complete record — moving their
photos, documents, history and contact links across and archiving the folded records, which stay
readable to a reviewer. Membership of a group never means the records are the same property: separate
units in one house are an ordinary case, and the import never merges.

### Smaller changes

- Employee access advances now invalidate protected sessions on the next request (#127).
- The invitation-session read and the release smoke test were corrected to check the canonical stage
  origin instead of a protection-gated deployment URL (#134).
- The three font families are vendored, so the release build stops fetching Google Fonts at build
  time (#139).
- Numbered inventory paging with a matching count (#140, #146) shipped and was superseded the next
  day by the streamed list above.

## 17 October 2026 — directories, invitations and province activity

### Shared-contact directory (#71, #121, #125, #126)

`/people/contacts` lists recorded identities with their readable per-property relationships, offers
an Owners view, and corrects one shared person in place through the same revision-checked operation
the property maintenance panel uses. A refused correction stays a localized inline message instead of
clearing the page.

_Known gaps:_ the hosted run passed on 17 October with its synthetic namespace removed; the
keyboard-only and 360px gates and re-verification at the final head remain outstanding.

### Role-bound employee invitations (#68, #123)

An admin records one invitation against a normalized address and one of the four existing company
roles; the invitee's employee row is created unlinked and inactive, and the role is re-read from that
row, never from editable Auth metadata. The real provider send was exercised on the development
project from the verified-domain sender, and the recorded role and invitation state render in the
admin employee list.

_Known gap:_ the delivered link reached the application through the provider but landed on the
project's Site URL rather than `/auth/invite`, for the allow-list reason above.

### Province owner-contact activity (#35, #124)

`/activity/provinces` is a manager/admin table of the same owner-contact units the company report
uses, grouped by the property's latest verified province with an always-reported "Unverified
location" group. It is a derived table, not a map and not a visit count, and correcting an address can
regroup earlier activity without changing the company total.

_Known gap:_ a written real-browser acceptance harness exists but was not executed; the evidence is
embedded/unit regressions.

### Independent sale corrections (#40) and restricted comment history (#47)

A manager or admin other than the credited employee can correct or reverse a sale completion through
its own record, and the reviewer-only comment history exposes a comment's original post, retained
edits and one removal event while refusing everyone else.

### Vendor links and vendor edit put on hold (#74, #75)

Property–vendor links shipped with guarded correction: every active employee may link or unlink a
recorded vendor on a property they can read, the current link row is the trail, and no property
history row is written. **Vendor detail editing (#75) was deliberately put on hold, not built**: its
acceptance criteria required each vendor edit to append before/after business history to every linked
property, which conflicts with the standing price-only property-history rule. Vendor records are
read-only today, and no vendor edit surface exists.

## 16 October 2026 — maintenance, discussion, activity and sale completion

### Property, contact and address maintenance (#7–#17)

The largest slice to date: create a property from a known address, edit facts and prices immediately,
correct addresses without rewriting their sources, optionally verify an address mapping, maintain
contact relationships, correct shared contact details across properties, and run correction requests
through submission, amendment, review and application. Asking-price history is recorded as separate
sale and rent series with the actor, Vietnam time and before/after whole-VND values, and an optional
retained explanation on a correction.

_Why it matters:_ this is where the inventory stops being a read-only import. Two rules in it are
deliberate and permanent: the original legacy address is never overwritten and a current address
never contains a district field; and property change history is **price-only by contract** — creation,
address, contact, link, note and status changes are attributed in the private audit trail instead,
which carries its own 90-day retention window and is not a permanent record. The record page's *Edit
facts* action opens the maintenance workspace in a dialog; there is no dedicated edit route.

_Known gap:_ the slice is implemented in source and awaits hosted/browser acceptance for several of
its tickets.

### Shared property discussion with accountable moderation (#44, #45)

Any active employee who can read a property can post to its flat discussion. The author may edit
their own current comment under a revision check, which retains every prior version and marks the
entry edited ([#46](#14-october-2026--reservations-prices-comments-and-vendors) is the author edit);
an author may remove their own comment without a reason, and a manager or admin may
remove any current comment with a required moderation reason — including on an archived property,
where author removal is blocked. A removed comment stays in place as a marker without its text.

_Why it matters:_ the discussion is shared and attributable rather than an editable note; nothing is
silently erased, and a removed or edited comment is reviewable afterwards.

_Known gaps:_ posting to an archived property is denied for every role, and only manager/admin read an
archived discussion.

### Personal and company activity (#28, #30, #31)

`/activity/me` reports the signed-in person's page views, distinct properties viewed and
owner-contact accesses for one Vietnam business day, plus the same three metrics over a chosen date
range where every requested day appears — an event-free day is an explicit zero, not a missing row.
`/activity/company` gives a manager/admin every currently active employee's activity by Vietnam day.
A page view is a detail read, not a physical visit, and owner-contact access counts one property per
employee per day, not owners, phones or calls.

### Independently confirmed sale completion (#38)

A manager or admin other than the credited employee confirms an actual completed sale — property,
explicitly selected credited closer, actual Vietnam completion date and contract reference — which
marks the property sold and closes open reservations while retaining their claimant and events. The
completed-sale ranking groups completions by credited closer over a validated Vietnam range, with
tied totals sharing a rank and genuinely unknown legacy attribution counted separately rather than
assigned to a guessed employee.

_Why it matters:_ an imported or manually set sold status, an approved reservation and a pending claim
are none of them a sale. Attribution is never inferred from who created, updated or reserved a
property.

_Known gaps:_ credited rental activation (#39) shipped in the same batch, but the completed-rentals
ranking is still unbuilt; the completed-sale confirmation is a dialog on the property record, not a
`/reviews/sale-completions` queue.

### Permanent sign-in account deletion with the retained employee (#67)

An employee's sign-in account can be deleted permanently while the employee row, UUID, name, role,
locale, every business reference and every uploader attribution are retained. Membership is disabled
and the restrictive Auth link cleared first; the departed employee's owned files have their technical
ownership reassigned to a live active admin custodian before the provider deletion, and completion
requires the provider to confirm the account absent.

_Why it matters:_ deleting an account no longer means deleting a person's work or rewriting their
attribution, and a half-finished provider step stays a visible, resumable partial state instead of
claiming success.

_Known gaps:_ this is the only place the Storage ownership reassignment mechanism is verified against
live Storage, and the migration that followed that run
(`20261015103500_storage_preflight_ownership_columns.sql`) has not been applied to the development
project, so the final head is unverified for live Storage until an authorized re-run happens.

## 15 October 2026 — owner-contact access recording and the activity ranking

- **Owner-contact access recording (#21).** The daily Vietnam-day unit the activity reports and the
  ranking are built on: one property per employee per day, recorded at the moment the number is
  revealed.
- **The owner-contact activity ranking (#34).** `/activity/company`'s ranking orders employees by
  their total daily owner-contact counts over a chosen Vietnam range, reconciled to the recorded
  events, with Page-view events and distinct properties viewed kept strictly separate and never
  blended into the rank. Every currently active employee appears, a zero total is an explicit row,
  equal totals share a rank with a stable order, and activity recorded while an employee was active
  stays attributed to them after deactivation.

_Why it matters:_ the ranking counts deliberate owner-contact disclosures — not calls, owners or
physical visits — and it is explicitly not a performance score or a commission ranking.

## 14 October 2026 — reservations, prices, comments and vendors

- **Owner-contact disclosure and daily property access (#29).** Revealing a property's recorded
  owner phone commits an owner-contact access event before the phone is shown, and counts one
  property per employee per Vietnam day rather than owners, phones or clicks.
- **Reservation request and independent decision (#18).** Any active employee requests a reservation
  on a property record; a manager or admin other than the claimant approves or rejects it with a
  reason, and release and expiry stay explicit. An effective reservation is an approved one whose
  expiry is still in the future — a pending request reserves nothing, and no second lock boolean
  exists on the property. Approval serializes on the property row and the database refuses self
  approval even for admins. The reservation identifies the **credited closer for attribution only**;
  there is no commission amount, calculation or payout anywhere in this release.
- **Asking-price history (#36).** A property's recorded sale asking prices and monthly asking rents
  render as separate newest-first series. An unknown value is a gap and a recorded zero stays zero;
  achieved sale prices, contractual rent, monthly dues and receipts are not part of either series.
- **Inventory age and chronological views (#37).** Properties carry the original date they entered
  the inventory, preserved from a reliable legacy source date or recorded when a genuinely new
  property is created, with oldest-first and newest-first views and a Vietnam-business-day age that
  does not reset when a property is relisted or corrected. A record with no reliable date is an
  explicit known gap that sorts after the dated records rather than an invented date.
- **Author comment editing (#46).** An author replaces their own current comment under a revision
  check, which retains every prior version, marks the entry edited, and keeps the comment's identity,
  author and posting position. _Known gap:_ the hosted/browser acceptance for the final head has not
  run.
- **Guarded employee deactivation (#66).** Membership is disabled first, and the exact sign-in block
  must be confirmed by the provider before the operation is complete; an unconfirmed result stays a
  recorded reconciliation state with access already disabled, and any authorized admin can resume the
  original operation without rewriting who started it. The database refuses any deactivation,
  demotion, unlink or removal that would leave no active admin, including a direct write.
  Deactivating an employee never releases, transfers or rewrites their outstanding reservations.
  _Known gap:_ implemented in source; the hosted/provider acceptance run has not executed.
- **Shared-contact correction by any active employee (#70).** Correcting the identity details of a
  shared contact applies to every property linked at that moment and commits immediately; it does not
  create, link, unlink or merge contacts.
- **Vendor directory (#73).** A company record with one optional contact block, readable by every
  active employee and creatable by staff, manager and admin, with an employee-scoped submission key
  so an interrupted create retries the same company instead of recording another.

## 13 October 2026 — the admin employee list

`/people/employees` (#65) gives an admin the employee directory with role and access state: linked,
active, inactive, unlinked and account-deleted are distinct states rather than one greyed-out row,
and a recorded invitation is shown as lifecycle evidence that does not make anybody linked.

## 12 October 2026 — the authentication design foundation

The canonical SGN design foundation was established for the authentication surfaces (#50), and the
sign-in (#52) and password-recovery (#51) screens were refactored onto it. The auth screens share the
token layer and the control vocabulary with the application but stay shell-free by design, so a
signed-out visitor never sees the app shell.

## 11 October 2026 — private property files, categories and cover photos

The first file slice (#22–#27, #33): read a property's private documents, upload and privately share
validated content with actual-content validation, recover an interrupted upload from the same
registered attachment, create and reuse company-wide document categories without approval, correct an
attachment's category, and choose at most one private cover photo. Completion is technical
confirmation that the stored content is supported, complete and matches its registration — it is not
human document review, legal authenticity or malware scanning, and a signed link is a short-lived
bearer link rather than a permanent share permission.

_Note:_ these files originally lived in Supabase Storage and were moved to R2 on 18 October; the
metadata contract is unchanged.

## 10 October 2026 — the foundation

The first working application: active-employee sign-in with protected browsing and local sign-out
(#2, #5), literal accent-insensitive legacy-address search (#3), read-only property and contact detail
with accurate page views (#4), persisted VI/EN switching that does not lose the employee's place
(#6), and delivered mailbox password recovery for active, inactive and unlinked identities (#1).

_Why it matters:_ the two rules that shape everything after it were set here — ordinary requests go
through the signed-in employee's session and RLS rather than a privileged key, and the interface is
Vietnamese by default with English available, without translating stored source records.
