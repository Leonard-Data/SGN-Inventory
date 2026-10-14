# Vietnamese legacy and current address model

## Evidence baseline

Decision 19/2025/QĐ-TTg provides the official province and commune code lists effective from 1 July 2025. The two-tier administrative model operates from that date. District labels are therefore retained for historical addresses and search, while current structured entry uses province/city and commune/ward. The HCMC reorganization in Resolution 1685/NQ-UBTVQH15 includes partial ward transfers. A ward-name substitution alone cannot resolve every property. See official links in `sources.md`.

This is an application data model derived from those sources. It does not establish legal title or alter a document's original address. Catalog ingestion must check for subsequent official changes rather than treating the 2025 list as permanently current. The seeded reference catalog below is pinned to a later upstream revision, so check for changes after that revision before ingesting any newer release.

## Entry and display rules

| Situation | Data captured | UI behavior |
| --- | --- | --- |
| New property with current address | Current province and ward selections, house number, street, entered text; save provenance | Default form; dependent ward list; hide district; show candidate until reviewed |
| New property known only by old address | Legacy city, district, ward, street, house number, original text | Explicit “Địa chỉ cũ”; save successfully; request mapping review |
| Imported legacy row | Preserve original full address and raw structured labels | Show “Địa chỉ cũ”; current address may be absent |
| One whole verified unit transition | Build a current candidate from official lineage and unchanged local address | Reviewer validates property/street evidence before marking verified |
| Partial unit transition | Store several crosswalk candidates; no automatic target assignment | “Cần xác minh phường mới”; require boundary/location/document/manual evidence |
| Old/new address on a certificate | Store address exactly as printed as evidence; retain uploaded document | Display beside current inventory address; never rewrite file contents |
| New official change after initial release | Insert new dated unit versions and transition records | Keep earlier addresses; update primary current address only after reviewed mapping |

Both old and new strings are searched through `property_addresses.search_text`. The first release displays a verified current address as primary when available; otherwise the old address remains the usable address. A current candidate can be displayed with a warning, but must not appear as verified in area analytics.

## Model example (illustrative)

`properties.id` identifies the building or parcel; it does not change when a ward changes. A property may have:

- A primary legacy address with city/district/ward labels and the untouched source full text.
- A primary current address with province/commune version IDs and no district.
- Additional nonprimary/alternate addresses for historical documents or aliases.

Version records hold official text codes, names, parents, validity dates and source URLs. Dates use `[valid_from, valid_to)`; NULL `valid_to` means no known end date. Crosswalk rows link old/new version IDs and state whether the change covers the whole unit, part of it, or a rename. These are a candidate-generation aid, not property-level proof.

## Verification workflow

1. Load official catalogs into an unpublished review batch; validate code/name/level, parent relationships, duplicate/overlapping validity and source provenance.
2. Match legacy labels using province **and** district **and** ward. Names such as “Phường 1” are not globally unique.
3. Create crosswalk candidates from official transition evidence. Never infer a missing `BDS-` property alias from an address mapping.
4. Resolve a split using property-level evidence. Manual decisions record reviewer, time, source and method.
5. Save the current address with verified unit IDs and the date on which those units apply. The database validates levels, parents, date validity and absence of district.
6. Retain the legacy address. For a later change, retain the previous current row as nonprimary before adding a replacement within one transaction.

Complete verified HCMC data first because all nonblank city labels in the property sheet are HCMC. Do not assume every physical location is correct merely because that column says HCMC.

### Seeded reference catalog

Migration `20261014075435_vietnamese_admin_units_reference.sql` seeds the national two-tier catalog into `admin_unit_versions` from the pinned [vietnamese-provinces-database v5.2.0](https://github.com/thanglequoc/vietnamese-provinces-database/tree/v5.2.0) PostgreSQL release (tag commit `62b1abdfe39625289c37a58ef6678e9db3d37f84`): 34 province/city rows and 3321 ward/commune/island-special-region rows, each carrying the official numeric code, the province → commune parent link, `valid_from = 2025-07-01` (the two-tier baseline) and the data's source URL. Codes, names and hierarchy are upstream verbatim; `name_vi` is the upstream `full_name`, with the one upstream record whose `full_name` had a lowercased type prefix (`06325`) taking the upstream canonical type label.

The catalog is a reference list, not a property-level verification. Selecting a province and commune from it does not establish a property's current address; a manager/admin still records evidence before `mapping_status = 'verified'`. The seed is idempotent and never rewrites a recorded address string.

Not seeded by this package: any district-level catalog (the upstream two-tier release carries none, so the delivered legacy district picker stays empty — use the free-text `district_text` label for a historical district), any old→new crosswalk or blanket mapping, and any HCMC-specific transition. Crosswalks remain reviewed evidence under the verification workflow above.

## Analytics and search

Current-area dashboards count properties with a **verified** current commune and place the remainder in “Chưa xác minh địa chỉ mới”. Old district is available as a historical reporting grouping. Do not present old-district geography as a current administrative hierarchy. Searches may match any address; result labels must indicate legacy/candidate/verified to explain the match.
