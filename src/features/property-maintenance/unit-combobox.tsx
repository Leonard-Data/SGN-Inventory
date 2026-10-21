'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { unitOptionLabels, type UnitOption } from './units';
import {
  closedCombobox,
  comboboxKey,
  filterUnitOptions,
  openCombobox,
  typeInCombobox,
  type ComboboxOption,
} from './combobox';

export type UnitChoice = UnitOption & { id: string };

// The official-unit picker: a text field that narrows the catalog as a person types. Only a
// listed unit can be committed — free text is never accepted, and a query that matches nothing
// says so — so the identifier the surrounding form submits is always an official one.
export function UnitCombobox({
  id,
  name,
  label,
  units,
  value,
  onChange,
  anyLabel,
  noMatch,
  error,
}: {
  id: string;
  // The form field the committed identifier reaches; the visible field carries typed text.
  name: string;
  label: string;
  units: readonly UnitChoice[];
  value: string;
  // The committed identifier, and the unit behind it when the list carries one, so a caller can
  // read the official name without a second lookup.
  onChange: (value: string, unit?: UnitChoice) => void;
  // Given only where "all units" is a condition the surrounding filter set can state.
  anyLabel?: string;
  noMatch: string;
  error?: string;
}) {
  const [state, setState] = useState(closedCombobox);
  const field = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const listId = id + '-list';
  const emptyId = id + '-empty';
  const options: ComboboxOption[] = [];
  if (anyLabel !== undefined) options.push({ value: '', label: anyLabel });
  // A recorded identifier the loaded catalog no longer carries stays visible and selected rather
  // than silently reading as "all units".
  if (value && !units.some((unit) => unit.id === value))
    options.push({ value, label: value });
  const names = unitOptionLabels(units);
  units.forEach((unit, index) =>
    options.push({ value: unit.id, label: names[index]! }),
  );
  const matches = filterUnitOptions(options, state.query);
  const selected = options.findIndex((option) => option.value === value);
  // Closed, the field states the committed unit's own name; typed text is what it shows while
  // the list is open, and it never survives as a value of its own.
  const shown =
    state.query ??
    options.find((option) => option.value === value)?.label ??
    '';
  const activeId =
    state.open && state.active >= 0 && matches[state.active]
      ? `${id}-option-${state.active}`
      : undefined;
  // The highlighted option may be below the fold of a long ward list or of the dialog's own
  // scrollport, so arrowing keeps it in view.
  useEffect(() => {
    if (!state.open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [state.open, activeId]);
  function open() {
    if (state.open) return;
    setState(openCombobox(selected));
    // The label is selected as well as shown, so the first keystroke replaces it instead of
    // appending to it.
    field.current?.select();
    // Opening near the bottom of a scrolling dialog brings the list into that scrollport.
    field.current?.scrollIntoView({ block: 'nearest' });
  }
  function commit(next: string) {
    // The form field carries the identifier from this moment on, before anything reads it.
    if (hidden.current) hidden.current.value = next;
    onChange(
      next,
      units.find((unit) => unit.id === next),
    );
    setState(closedCombobox);
    // A surrounding form tracks its unsaved state from its own events, and a field written this
    // way raises none, so the commit announces itself now that the field it reads is current.
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }));
    // On the next frame React has written the committed name, so the field is selected again and
    // the next keystroke starts a new search instead of appending to the name.
    requestAnimationFrame(() => field.current?.select());
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    const current = state;
    if (
      !current.open &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      open();
      return;
    }
    const list = filterUnitOptions(options, current.query);
    const result = comboboxKey(current, event.key, list.length);
    if (!result.handled) return;
    event.preventDefault();
    const chosen = result.commit === null ? undefined : list[result.commit];
    if (chosen) commit(chosen.value);
    else setState(result.state);
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="combobox">
        <input
          ref={field}
          id={id}
          className="input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={state.open}
          aria-controls={state.open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={state.open && !matches.length ? emptyId : undefined}
          value={shown}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setState(
              typeInCombobox(typed, filterUnitOptions(options, typed).length),
            );
          }}
          onFocus={open}
          onClick={open}
          onKeyDown={keyDown}
          onBlur={() => setState(closedCombobox)}
        />
        <input ref={hidden} type="hidden" name={name} value={value} />
        {state.open ? (
          <div className="combobox-pop">
            <ul
              className="combobox-list"
              id={listId}
              role="listbox"
              aria-label={label}
            >
              {matches.map((option, index) => (
                <li
                  key={option.value}
                  id={`${id}-option-${index}`}
                  className="combobox-option"
                  role="option"
                  aria-selected={option.value === value}
                  data-active={index === state.active ? 'true' : undefined}
                  // The pointer keeps the field focused, so the list closes after the selection
                  // rather than under it.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(option.value);
                  }}
                >
                  {option.label}
                </li>
              ))}
            </ul>
            {matches.length ? null : (
              <p className="combobox-empty" id={emptyId} role="status">
                {noMatch}
              </p>
            )}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
