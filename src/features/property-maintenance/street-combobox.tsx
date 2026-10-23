'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { STREET_NAMES } from './streets';
import {
  closedCombobox,
  openCombobox,
  streetComboboxKey,
  streetSuggestions,
} from './combobox';

// The street field as a combobox: the known street names are offered while a person types, and a
// street the list does not name is what the field keeps. The field's own text is the value it
// submits, so a save stores exactly the street that was typed here, listed or not.
export function StreetCombobox({
  id,
  name,
  label,
  initial,
  hint,
}: {
  id: string;
  // The form field the street reaches; the visible field is the one that submits.
  name: string;
  // The field's label, used to name the suggestion list.
  label: string;
  initial: string;
  hint: string;
}) {
  const [value, setValue] = useState(initial),
    [state, setState] = useState(closedCombobox);
  const field = useRef<HTMLInputElement>(null);
  const listId = id + '-list',
    hintId = id + '-hint';
  const matches = streetSuggestions(STREET_NAMES, state.query);
  // Closed, the field states the street it holds; typed text is what it shows while the list is open.
  const shown = state.query ?? value;
  const showsList = state.open && matches.length > 0;
  const activeId =
    showsList && state.active >= 0 && matches[state.active]
      ? `${id}-option-${state.active}`
      : undefined;
  // The highlighted name may be below the fold of the list's own scrollport, so arrowing keeps it in
  // view.
  useEffect(() => {
    if (!state.open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [state.open, activeId]);
  function open() {
    if (state.open) return;
    setState(openCombobox(matches.indexOf(value)));
  }
  // A picked suggestion fills the field exactly as typing it would.
  function commit(street: string) {
    setValue(street);
    setState(closedCombobox);
    // A value written this way raises no input event, and the surrounding form tracks the address
    // from those events, so the choice announces itself once React has written it.
    requestAnimationFrame(() =>
      field.current?.dispatchEvent(new Event('input', { bubbles: true })),
    );
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!state.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      open();
      return;
    }
    const result = streetComboboxKey(state, event.key, matches.length);
    if (!result.handled) return;
    event.preventDefault();
    const chosen = result.commit === null ? undefined : matches[result.commit];
    if (chosen === undefined) setState(result.state);
    else commit(chosen);
  }
  return (
    <>
      <div className="combobox">
        <input
          ref={field}
          id={id}
          className="input"
          type="text"
          name={name}
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={showsList}
          aria-controls={showsList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={hintId}
          value={shown}
          maxLength={2000}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setValue(typed);
            // Typing highlights nothing: a suggestion is taken with the arrows or the pointer, so
            // Enter keeps the street that was typed even where the list does not name it.
            setState({ open: true, query: typed, active: -1 });
          }}
          onFocus={open}
          onClick={open}
          onKeyDown={keyDown}
          onBlur={() => setState(closedCombobox)}
        />
        {showsList ? (
          <div className="combobox-pop">
            <ul
              className="combobox-list"
              id={listId}
              role="listbox"
              aria-label={label}
            >
              {matches.map((street, index) => (
                <li
                  key={street}
                  id={`${id}-option-${index}`}
                  className="combobox-option"
                  role="option"
                  aria-selected={street === value}
                  data-active={index === state.active ? 'true' : undefined}
                  // The pointer keeps the field focused, so the list closes after the selection
                  // rather than under it.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(street);
                  }}
                >
                  {street}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="field-hint" id={hintId}>
        {hint}
      </p>
    </>
  );
}
