// The local address index: the catalogue's recorded addresses folded once per property, and the
// match the address box runs while a person types. Folding is the accent-insensitive comparison
// the database's own address search documents, kept here so a keystroke reads nothing at all.
//
// Each stored variant is indexed and searched on its own, so an old address's district can never
// be matched against a current address's ward. A variant is indexed on the recorded text it carries,
// the address parts beside it and the official names of the units it chose, and a query naming the
// locality a variant records is answered by that variant rather than by one that only carries the
// words in a text copied from it. A house number is a structured value, not a
// substring: 12, 112 and 12/5 are three different places and 12A keeps its letter. Ranking follows
// the order the specification sets out (issue #186 section 6, issue #191) and the recorded text is
// kept for display.
import type { AddressSummary, PropertySummary } from './types';

export type CatalogueAddressVariant = {
  // The recorded format the variant was stored in: legacy, current or alternate.
  format: string;
  // The recorded address text exactly as entered. Display reads this, never the folded form.
  addressText: string;
  // The normalized comparison form of the recorded address text alone.
  folded: string;
  // Every normalized token this variant may be matched on: the recorded text plus the carried
  // house number, street, commune and district parts.
  tokens: string[];
  // The variant's own normalized house number, and the main number a slash form sits under.
  houseNumber: string | null;
  mainNumber: string | null;
  streetTokens: string[];
  localityTokens: string[];
  // The official names of the units this variant chose, normalized. A query token that names one of
  // them is a statement about this variant's own recorded hierarchy rather than a word it happens to
  // carry inside an address text copied from another format.
  officialTokens: string[];
};

export type CatalogueIndexEntry = {
  record: PropertySummary;
  variants: CatalogueAddressVariant[];
  // The folded recorded property code, the summary field the database's own text search matches
  // beside the address.
  code: string;
};

// One result: the property and the stored format of the variant that matched it, so the list can
// say which recorded address was found.
export type CatalogueMatch = {
  record: PropertySummary;
  format: string;
};

// Controlled contextual abbreviations, expanded only when the whole token is one of these and only
// to the name it stands for: P. to Phường, Q. to Quận and so on. Nothing here infers an official
// boundary change, and nothing rewrites the recorded text - the expansion is comparison only.
const ABBREVIATIONS: Record<string, string[]> = {
  p: ['phuong'],
  q: ['quan'],
  tp: ['thanh', 'pho'],
  tt: ['thi', 'tran'],
  h: ['huyen'],
  x: ['xa'],
  kp: ['khu', 'pho'],
};

// 12, 12A, 12/5 and 12/5A are house numbers; 125 Nguyễn Văn Thương is not.
const HOUSE_NUMBER = /^\d+[a-z]?(?:\/\d+[a-z]?)*$/;

function tokenize(text: string): string[] {
  const normalized = text
    // One Unicode representation first, then the accent-insensitive comparison the database's own
    // address search documents. đ is a letter of its own rather than an accented d, so it is
    // mapped explicitly. Punctuation is a separator, except the slash that keeps 12/5 whole.
    .normalize('NFC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  return normalized
    .split(' ')
    .flatMap((token) => ABBREVIATIONS[token] ?? [token]);
}

// The comparison form of an address: case-folded, without accent marks, with đ read as d, with
// repeated whitespace and punctuation collapsed, and with unambiguous abbreviations expanded.
// House-number structure (12/5, 12A) survives untouched, and nothing is added to the text: an
// unrecorded new ward name is never inferred from an old one.
export function foldAddress(text: string): string {
  return tokenize(text).join(' ');
}

function firstSegment(text: string): string {
  return text.split(',')[0] ?? '';
}

function houseNumberValue(
  structured: string | null,
  headTokens: readonly string[],
): string | null {
  // A carried column wins, with any internal spacing collapsed ("12 A" is the number 12A).
  const carried = structured ? tokenize(structured).join('') : '';
  if (carried && HOUSE_NUMBER.test(carried)) return carried;
  const first = headTokens[0];
  return first && HOUSE_NUMBER.test(first) ? first : null;
}

function variantOf(address: AddressSummary): CatalogueAddressVariant {
  const textTokens = tokenize(address.addressText);
  const headTokens = tokenize(firstSegment(address.addressText));
  const partTokens = tokenize(
    [address.houseNumber, address.street, address.commune, address.district]
      .filter((part): part is string => Boolean(part))
      .join(' '),
  );
  const houseNumber = houseNumberValue(address.houseNumber, headTokens);
  const mainNumber =
    houseNumber && houseNumber.includes('/')
      ? houseNumber.slice(0, houseNumber.indexOf('/'))
      : houseNumber;
  const carriedStreet = address.street ? tokenize(address.street) : [];
  const streetTokens = carriedStreet.length
    ? carriedStreet
    : headTokens[0] && HOUSE_NUMBER.test(headTokens[0])
      ? headTokens.slice(1)
      : headTokens;
  // The locality the variant's own columns state, without the words the recorded text adds below.
  const columnLocalities = tokenize(
    [address.commune, address.district]
      .filter((part): part is string => Boolean(part))
      .join(' '),
  );
  const localityTokens = [
    ...columnLocalities,
    ...tokenize(address.addressText.split(',').slice(1).join(' ')),
  ];
  // The official names of the units the address chose. A unit picked from a list is often named
  // nowhere in the recorded text, so without these a ward chosen by selection is unsearchable here.
  const officialTokens = (address.units ?? []).flatMap((name) =>
    tokenize(name),
  );
  return {
    format: address.format,
    addressText: address.addressText,
    folded: textTokens.join(' '),
    // A slash form is searched by its main number too, so a main-number query can surface the
    // alley beneath it at a lower rank. A plain number carries no such extra token, so 12 does
    // not reach 12A.
    tokens:
      mainNumber && mainNumber !== houseNumber
        ? [...textTokens, ...partTokens, ...officialTokens, mainNumber]
        : [...textTokens, ...partTokens, ...officialTokens],
    houseNumber,
    mainNumber,
    streetTokens,
    localityTokens,
    officialTokens,
  };
}

// The index is built once per loaded page rather than once per keystroke: every property's variants
// are folded here, and the record itself is kept so a result draws its recorded address text.
export function buildAddressIndex(
  records: readonly PropertySummary[],
): CatalogueIndexEntry[] {
  return records.map((record) => ({
    record,
    variants: record.addresses.map(variantOf),
    code: tokenize(record.propertyCode).join(' '),
  }));
}

type Query = {
  folded: string;
  tokens: string[];
  // The house number the query starts with, when it starts with one.
  houseNumber: string | null;
};

function queryOf(query: string): Query {
  const tokens = tokenize(query);
  const first = tokens[0];
  return {
    folded: tokens.join(' '),
    tokens,
    houseNumber: first && HOUSE_NUMBER.test(first) ? first : null,
  };
}

// A house number is a structured value: a numeric token matches only an equal token, so 12 never
// matches 112 and 12 never reaches 12A. Every other token matches as a typed prefix, so a partial
// street name finds the recorded one.
function tokenMatches(queryToken: string, variantToken: string): boolean {
  return /^\d/.test(queryToken)
    ? queryToken === variantToken
    : variantToken.startsWith(queryToken);
}

// The ranking the specification sets out, lower first: the exact recorded property code, the exact
// normalized address, the exact house number with its street, the alley sitting under the queried
// main number, the street with its locality, and then the looser all-token and prefix matches.
// `prefixPenalty` counts the query tokens that only matched as a prefix, so an exact token outranks
// a prefix within a rank.
const EXACT_CODE = 1;
const EXACT_ADDRESS = 2;
const NUMBER_AND_STREET = 3;
const ALLEY_UNDER_NUMBER = 4;
const STREET_AND_LOCALITY = 5;
// A query that names the official unit this variant chose. It sits above the loosest rank so a
// fragment naming an old district is answered by the variant that records that district, never by a
// variant that only carries the same words inside an address text copied over from it.
const CHOSEN_UNIT = 6;
const ALL_TOKENS = 7;

type Ranked = { rank: number; prefixPenalty: number };

function rankVariant(
  query: Query,
  variant: CatalogueAddressVariant,
): Ranked | null {
  // Every meaningful token of the query must match within this one variant, or the variant is not
  // a candidate at all.
  if (
    !query.tokens.every((token) =>
      variant.tokens.some((other) => tokenMatches(token, other)),
    )
  )
    return null;
  const prefixPenalty = query.tokens.filter(
    (token) => !variant.tokens.includes(token),
  ).length;
  if (query.folded === variant.folded)
    return { rank: EXACT_ADDRESS, prefixPenalty };
  const rest = query.houseNumber
    ? query.tokens.filter((token) => token !== query.houseNumber)
    : query.tokens;
  if (
    query.houseNumber !== null &&
    variant.houseNumber === query.houseNumber &&
    variant.streetTokens.length > 0 &&
    rest.every((token) =>
      variant.streetTokens.some((other) => tokenMatches(token, other)),
    )
  )
    return { rank: NUMBER_AND_STREET, prefixPenalty };
  if (
    query.houseNumber !== null &&
    variant.mainNumber === query.houseNumber &&
    variant.houseNumber !== variant.mainNumber
  )
    return { rank: ALLEY_UNDER_NUMBER, prefixPenalty };
  if (
    query.tokens.some((token) =>
      variant.streetTokens.some((other) => tokenMatches(token, other)),
    ) &&
    query.tokens.some((token) =>
      variant.localityTokens.some((other) => tokenMatches(token, other)),
    )
  )
    return { rank: STREET_AND_LOCALITY, prefixPenalty };
  if (
    variant.officialTokens.length > 0 &&
    query.tokens.every((token) =>
      variant.officialTokens.some((other) => tokenMatches(token, other)),
    )
  )
    return { rank: CHOSEN_UNIT, prefixPenalty };
  return { rank: ALL_TOKENS, prefixPenalty };
}

function compareRank(left: Ranked, right: Ranked): number {
  return left.rank - right.rank || left.prefixPenalty - right.prefixPenalty;
}

// A stable property identity as the final tie-break, so the same search always returns the same
// order.
function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// The recorded property code, which the database's own text search matches beside the address
// (`stream_inventory` reads `property_code` too). An exact code is the strongest result there is;
// a code fragment the query falls inside stays at the loosest rank, so it never displaces an
// address match.
function codeRank(query: Query, entry: CatalogueIndexEntry): number | null {
  if (!query.folded || !entry.code) return null;
  if (query.folded === entry.code) return EXACT_CODE;
  return entry.code.includes(query.folded) ? ALL_TOKENS : null;
}

// The properties whose recorded address matches what the person typed, best first. Each stored
// variant is searched on its own, so a query can never match a mixture of an old district and a
// current ward, and a property matches when any one of its variants does. An empty query is the
// whole loaded page, never an empty result.
export function matchCatalogue(
  index: readonly CatalogueIndexEntry[],
  query: string,
): CatalogueMatch[] {
  const parsed = queryOf(query);
  if (parsed.tokens.length === 0)
    return index.map((entry) => ({
      record: entry.record,
      format: entry.variants[0]?.format ?? '',
    }));
  const found: { ranked: Ranked; match: CatalogueMatch }[] = [];
  for (const entry of index) {
    let best: Ranked | null = null;
    let bestFormat = '';
    for (const variant of entry.variants) {
      const ranked = rankVariant(parsed, variant);
      if (!ranked) continue;
      if (!best || compareRank(ranked, best) < 0) {
        best = ranked;
        bestFormat = variant.format;
      }
    }
    const code = codeRank(parsed, entry);
    if (code !== null && (!best || code < best.rank)) {
      best = { rank: code, prefixPenalty: 0 };
      bestFormat = '';
    }
    if (best)
      found.push({
        ranked: best,
        match: { record: entry.record, format: bestFormat },
      });
  }
  found.sort(
    (left, right) =>
      compareRank(left.ranked, right.ranked) ||
      compareId(left.match.record.id, right.match.record.id),
  );
  return found.map((entry) => entry.match);
}
