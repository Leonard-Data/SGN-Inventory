'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { newListStateCarrier, type ListStateCarrier } from './list-state';

// One carrier for the whole authenticated shell, created once per browser session: the list's own
// state outlives every route inside the shell, which is what a visit to a property and back needs,
// and a reload of the application is what starts it over. Nothing here authorizes anything or holds
// a row - it is where a list was left, not what it showed.
const ListStateContext = createContext<ListStateCarrier | null>(null);

export function InventoryListStateProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [carrier] = useState(newListStateCarrier);
  return (
    <ListStateContext.Provider value={carrier}>
      {children}
    </ListStateContext.Provider>
  );
}

export function useListStateCarrier(): ListStateCarrier {
  const carrier = useContext(ListStateContext);
  if (!carrier)
    throw new Error(
      'useListStateCarrier needs InventoryListStateProvider, which the authenticated layout mounts',
    );
  return carrier;
}
