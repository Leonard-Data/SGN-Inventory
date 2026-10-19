'use client';
import { useEffect, useRef } from 'react';

// The browser measures each mounted chunk of the stream, so the space reserved for the chunks
// around it follows what rows actually take instead of the starting estimate. A chunk that is
// only reserving space right now is not measured at all: its height is that reservation, and
// reporting it back would lock the estimate in as if it had been measured.
//
// The observer is connected to the current render's own values and reconnected when they change:
// an observer created for one render would otherwise have to read what to report from a mutable
// holder, which is exactly the ref-during-render the component model refuses.
export function useMeasuredHeight<T extends HTMLElement>({
  index,
  active,
  report,
}: {
  index: number;
  // True while the chunk draws rows of its own; false while it is a reserved gap.
  active: boolean;
  report: (index: number, height: number) => void;
}) {
  const element = useRef<T | null>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || !active) return;
    const measure = () => report(index, node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [index, active, report]);
  return element;
}
