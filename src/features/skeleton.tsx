'use client';
import { useEffect, useState, type ReactNode } from 'react';
import {
  SKELETON_FLASH_GUARD_MS,
  SKELETON_REGION,
  skeletonRows,
  type SkeletonShape,
} from './skeleton-shape';

// One grey block: the atom every surface composes its own content shape from. `h` is
// omitted where a class already sizes the block (an aspect-ratio cover, for instance).
export function Skeleton({
  h,
  w = '100%',
  className,
}: {
  h?: number | string;
  w?: number | string;
  className?: string;
}) {
  return (
    <span
      className={'skeleton' + (className ? ' ' + className : '')}
      style={{ height: h, width: w }}
      aria-hidden="true"
    />
  );
}

// A page of result cards stands in for a page of result cards: the property grid the
// inventory returns is the only surface with this shape, and the review route renders it too.
export function SkeletonCards({
  label,
  count = 3,
}: {
  label: string;
  count?: number;
}) {
  return (
    <LoadingSkeleton label={label}>
      <div className="sk-cards">
        {Array.from({ length: count }, (_, card) => (
          <div className="sk-card" key={card}>
            <Skeleton className="sk-cover" />
            <div className="sk-body">
              <Skeleton h={16} w="45%" />
              <Skeleton h={22} w="85%" />
              <Skeleton h={21} w="60%" />
              <Skeleton h={21} w="40%" />
              <Skeleton h={26} w="32%" />
            </div>
          </div>
        ))}
      </div>
    </LoadingSkeleton>
  );
}

// The reserved region itself: one polite announcement, aria-hidden shapes, and a short
// guard so content that arrives immediately never flashes a placeholder. Pass children
// when the surface's shape is more than a stack of lines; they render inside the same
// hidden box, under the same single announcement.
export function LoadingSkeleton({
  label,
  shape = 'lines',
  rows = 3,
  columns = 3,
  className,
  children,
}: {
  label: string;
  shape?: SkeletonShape;
  rows?: number;
  columns?: number;
  className?: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SKELETON_FLASH_GUARD_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <div
      {...SKELETON_REGION}
      className={'skeleton-region' + (className ? ' ' + className : '')}
    >
      <span className="sr">{label}</span>
      <div className={'skeleton-shape sk-' + shape} aria-hidden="true">
        {children ??
          skeletonRows(shape, rows, columns).map((row, index) => (
            <div
              key={index}
              className="sk-item"
              style={
                shape === 'table'
                  ? {
                      gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                    }
                  : undefined
              }
            >
              {row.map((box, cell) => (
                <Skeleton key={cell} h={box.h} w={box.w} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
