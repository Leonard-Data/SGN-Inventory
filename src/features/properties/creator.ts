// Who created a property, as a colleague would recognise them: the display name of the
// employee the record already references. An absent, deleted or unreadable creator shows
// nothing at all - no placeholder, no raw identifier, and never the sign-in address.

export function creatorName(
  displayName: string | null | undefined,
): string | null {
  const name = displayName?.trim();
  if (!name) return null;
  // An employee's display name is a name; an address in this slot is a mapping mistake,
  // and nothing an address shows may reach the card.
  return name.includes('@') ? null : name;
}

// Property id → the display name of the colleague a record references in one attribution column,
// for the page of records a read just returned. Built once so each card is an O(1) lookup, and it
// holds only the names that resolve.
function attributionNames<Row extends { id: string }>(
  properties: readonly Row[],
  employees: { id: string; display_name: string | null }[],
  reference: (property: Row) => string | null,
): Map<string, string> {
  const byId = new Map(employees.map((row) => [row.id, row.display_name]));
  const names = new Map<string, string>();
  for (const property of properties) {
    const id = reference(property);
    const name = id ? creatorName(byId.get(id)) : null;
    if (name) names.set(property.id, name);
  }
  return names;
}

export function propertyCreators(
  properties: readonly { id: string; created_by: string | null }[],
  employees: { id: string; display_name: string | null }[],
): Map<string, string> {
  return attributionNames(
    properties,
    employees,
    (property) => property.created_by,
  );
}

// The colleague who last modified each record, resolved exactly as the creator is: the list and
// the quick view state both attributions from the same summary.
export function propertyModifiers(
  properties: readonly { id: string; updated_by: string | null }[],
  employees: { id: string; display_name: string | null }[],
): Map<string, string> {
  return attributionNames(
    properties,
    employees,
    (property) => property.updated_by,
  );
}
