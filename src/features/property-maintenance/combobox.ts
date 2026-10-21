// The administrative-unit picker's type-to-search behaviour, kept out of the component so the
// filtering and the keyboard contract can be tested without a DOM. The unit names themselves are
// source data: nothing here rewrites them, it only decides which ones a typed prefix shows.

export type ComboboxOption = { value: string; label: string };

export type ComboboxState = {
  open: boolean;
  // The typed text; null while the field shows the committed selection's own label.
  query: string | null;
  // The highlighted option's index in the filtered list, -1 when nothing is highlighted.
  active: number;
};

export const closedCombobox: ComboboxState = {
  open: false,
  query: null,
  active: -1,
};

// A person types what the keyboard offers: matching ignores case and diacritics, so "dong nai"
// reaches "Tỉnh Đồng Nai".
export function foldUnitName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

// The list a query shows: every option while nothing is typed, otherwise the ones whose name
// contains the text. The committed selection is not held separately — a filtered-away option is
// simply not offered, and the field's own text still shows what is recorded.
export function filterUnitOptions(
  options: readonly ComboboxOption[],
  query: string | null,
): ComboboxOption[] {
  const needle = foldUnitName(query?.trim() ?? '');
  if (!needle) return [...options];
  return options.filter((option) =>
    foldUnitName(option.label).includes(needle),
  );
}

// Opening shows the whole list with the committed selection highlighted, so a reopened picker
// still says what is recorded.
export function openCombobox(selected: number): ComboboxState {
  return { open: true, query: null, active: selected };
}

// Typing filters the list and highlights its first match; no match leaves nothing highlighted,
// which is what makes Enter commit nothing.
export function typeInCombobox(
  query: string,
  matchCount: number,
): ComboboxState {
  return { open: true, query, active: matchCount > 0 ? 0 : -1 };
}

export type ComboboxKeyResult = {
  state: ComboboxState;
  // The index in the filtered list that Enter commits, or null.
  commit: number | null;
  // Whether this key belonged to the picker. An unhandled Enter reaches the surrounding form.
  handled: boolean;
};

const move = (state: ComboboxState, active: number): ComboboxState => ({
  ...state,
  active,
});

// The keyboard contract: the arrows move and wrap, Home/End go to the ends, Enter commits the
// highlighted option, Escape closes and leaves the committed value alone.
export function comboboxKey(
  state: ComboboxState,
  key: string,
  count: number,
): ComboboxKeyResult {
  const passThrough: ComboboxKeyResult = {
    state,
    commit: null,
    handled: false,
  };
  if (key === 'Enter') {
    // Closed, Enter is the surrounding form's own submit.
    if (!state.open) return passThrough;
    // Open, it can only commit an official unit; free text is never accepted, and the message
    // that says so stays on screen.
    if (state.active < 0 || state.active >= count)
      return { state: move(state, -1), commit: null, handled: true };
    return { state: closedCombobox, commit: state.active, handled: true };
  }
  if (key === 'Escape') {
    if (!state.open) return passThrough;
    return { state: closedCombobox, commit: null, handled: true };
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (!state.open)
      return { state: openCombobox(state.active), commit: null, handled: true };
    if (count === 0)
      return { state: move(state, -1), commit: null, handled: true };
    const step = key === 'ArrowDown' ? 1 : -1;
    // From nothing highlighted the first arrow lands on an end of the list.
    const from = state.active < 0 ? (step > 0 ? -1 : 0) : state.active;
    return {
      state: move(state, (((from + step) % count) + count) % count),
      commit: null,
      handled: true,
    };
  }
  if (key === 'Home' || key === 'End') {
    if (!state.open || count === 0) return passThrough;
    return {
      state: move(state, key === 'Home' ? 0 : count - 1),
      commit: null,
      handled: true,
    };
  }
  return passThrough;
}
