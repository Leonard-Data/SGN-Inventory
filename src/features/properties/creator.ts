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

// Property id → creator display name, for the page of records a read just returned. Built
// once so each card is an O(1) lookup, and it holds only the names that resolve.
export function propertyCreators(
  properties: { id: string; created_by: string | null }[],
  employees: { id: string; display_name: string | null }[],
): Map<string, string> {
  const byId = new Map(employees.map((row) => [row.id, row.display_name]));
  const creators = new Map<string, string>();
  for (const property of properties) {
    const name = property.created_by
      ? creatorName(byId.get(property.created_by))
      : null;
    if (name) creators.set(property.id, name);
  }
  return creators;
}
