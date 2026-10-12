import type { Locale } from '@/i18n/messages';
import {
  SHEETS,
  computeGeometry,
  layoutTarget,
  fmt,
  directionAngle,
  type Variant,
  type RecordFields,
} from './plate';
import { plateCopy } from './plate-copy';

export interface PlateProps {
  variant: Variant;
  record: RecordFields & { property_code?: string | null };
  locale: Locale;
}

export function Plate({ variant, record, locale }: PlateProps) {
  const sheet = SHEETS[variant];
  const g = computeGeometry(record);
  const c = plateCopy(locale);
  const uid = (record.property_code || 'plate').replace(/[^a-zA-Z0-9]/g, '');
  const labelParts: string[] = [];

  if (!g.drawable) {
    return (
      <svg
        className={`plate plate-${variant}`}
        viewBox={`0 0 ${sheet.w} ${sheet.h}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
        role="img"
        aria-label={`${record.property_code || ''} — ${c.noData}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          className="plate-sheet"
          x={0}
          y={0}
          width={sheet.w}
          height={sheet.h}
        />
        <text
          className="plate-title"
          x={sheet.w / 2}
          y={sheet.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {c.noData}
        </text>
      </svg>
    );
  }

  const target = g.plot || g.built!;
  const lay = layoutTarget(sheet, g)!;
  const text = variant !== 'bare';

  /* ARIA label */
  labelParts.push(g.plot ? c.ariaPlot : c.ariaUnit);
  if (g.plot) {
    labelParts.push(
      c.ariaPlotDim.replace('{w}', fmt(g.plot.w)).replace('{d}', fmt(g.plot.d)),
    );
  } else {
    labelParts.push(`${fmt(g.land)} m²`);
  }
  if (g.built) {
    labelParts.push(c.ariaBuilt.replace('{a}', fmt(g.built.area)));
  }
  if (g.derivedAspect) {
    labelParts.push(c.ariaDerived);
  }

  /* Grid lines */
  const gridLines: JSX.Element[] = [];
  if (text) {
    const step = 10 * sheet.ppm;
    for (
      let x = sheet.plan.x + step;
      x < sheet.plan.x + sheet.plan.w;
      x += step
    ) {
      gridLines.push(
        <path
          key={`gv${x}`}
          d={`M ${fmtpx(x)} ${sheet.plan.y} V ${sheet.plan.y + sheet.plan.h}`}
        />,
      );
    }
    for (let y = lay.baseY - step; y > sheet.plan.y; y -= step) {
      gridLines.push(
        <path
          key={`gh${y}`}
          d={`M ${sheet.plan.x} ${fmtpx(y)} H ${sheet.plan.x + sheet.plan.w}`}
        />,
      );
    }
  }

  /* Access line (street/alley edge) */
  const accessLine = g.plot ? (
    <path
      d={`M ${fmtpx(lay.px - (text ? 10 : 6))} ${lay.baseY + 3} H ${fmtpx(lay.px + lay.pw + (text ? 10 : 6))}`}
      stroke="var(--field-border)"
      strokeWidth={variant === 'hero' ? 2 : 1.4}
      strokeLinecap="round"
      fill="none"
    />
  ) : null;

  /* Plot rect */
  const plotRect = g.plot ? (
    <rect
      className={`plate-plot${g.derivedAspect ? ' is-derived' : ''}`}
      x={fmtpx(lay.px)}
      y={fmtpx(lay.py)}
      width={fmtpx(lay.pw)}
      height={fmtpx(lay.pd)}
      fill={`url(#pt${uid})`}
    />
  ) : null;

  /* Built footprint */
  let builtRect: JSX.Element | null = null;
  if (g.built) {
    const bx =
      g.plot && g.built.w === g.frontage && g.frontage > 0
        ? lay.px
        : lay.px + (lay.pw - g.built.w * sheet.ppm) / 2;
    builtRect = (
      <rect
        className="plate-built"
        x={fmtpx(bx)}
        y={fmtpx(lay.baseY - g.built.d * sheet.ppm)}
        width={fmtpx(g.built.w * sheet.ppm)}
        height={fmtpx(g.built.d * sheet.ppm)}
      />
    );
  }

  /* Dimensions */
  const dimH =
    text && variant === 'hero' ? (
      <g stroke="var(--field-border)" strokeWidth={1} fill="none">
        <path
          d={`M ${fmtpx(lay.px)} ${lay.baseY + 11} H ${fmtpx(lay.px + lay.pw)}`}
        />
        <path d={`M ${fmtpx(lay.px)} ${lay.baseY + 7} V ${lay.baseY + 15}`} />
        <path
          d={`M ${fmtpx(lay.px + lay.pw)} ${lay.baseY + 7} V ${lay.baseY + 15}`}
        />
        <text
          className="plate-dim"
          x={fmtpx((lay.px + lay.px + lay.pw) / 2)}
          y={lay.baseY + 25}
          textAnchor="middle"
        >
          {fmt(g.unit ? g.built!.w : target.w)} {c.scale}
        </text>
      </g>
    ) : null;

  const dimV = text ? (
    <g stroke="var(--field-border)" strokeWidth={1} fill="none">
      <path
        d={`M ${Math.round(lay.px + lay.pw + 16)} ${fmtpx(lay.py)} V ${fmtpx(lay.baseY)}`}
      />
      <path
        d={`M ${Math.round(lay.px + lay.pw + 12)} ${fmtpx(lay.py)} H ${Math.round(lay.px + lay.pw + 20)}`}
      />
      <path
        d={`M ${Math.round(lay.px + lay.pw + 12)} ${fmtpx(lay.baseY)} H ${Math.round(lay.px + lay.pw + 20)}`}
      />
      <text
        className="plate-dim"
        x={Math.round(lay.px + lay.pw + 24)}
        y={fmtpx((lay.py + lay.baseY) / 2 + 3)}
      >
        {fmt(target.d)} {c.scale}
      </text>
    </g>
  ) : null;

  /* North arrow */
  const angle = directionAngle(record.direction);
  const northArrow = text ? (
    <g>
      <g
        transform={`translate(${sheet.plan.x + sheet.plan.w - 10}, ${sheet.plan.y + 14}) rotate(${angle})`}
      >
        <path
          d="M 0 8 V -7"
          stroke="var(--muted)"
          strokeWidth={1.2}
          fill="none"
        />
        <path d="M 0 -8.5 L -3.2 -2.6 L 3.2 -2.6 Z" fill="var(--muted)" />
      </g>
      <text
        className="plate-north"
        x={sheet.plan.x + sheet.plan.w - 10}
        y={sheet.plan.y + 32}
        textAnchor="middle"
      >
        {c.north}
      </text>
    </g>
  ) : null;

  /* Data column */
  const dataRows: JSX.Element[] = [];
  if (text && sheet.col) {
    let cy = 56;
    const stepY = variant === 'hero' ? 44 : 38;
    const cx = sheet.col.x;
    if (g.plot) {
      dataRows.push(
        <text key="l1" className="plate-row-label" x={cx} y={cy}>
          {c.land}
        </text>,
        <text
          key="v1"
          className={`plate-row-value${variant === 'hero' ? ' is-big' : ''}`}
          x={cx}
          y={cy + (variant === 'hero' ? 18 : 16)}
        >
          {fmt(g.land)} m²
        </text>,
      );
      cy += stepY;
      dataRows.push(
        <text key="l2" className="plate-row-label" x={cx} y={cy}>
          {c.dims}
        </text>,
        <text
          key="v2"
          className={`plate-row-value${variant === 'hero' ? ' is-big' : ''}`}
          x={cx}
          y={cy + (variant === 'hero' ? 18 : 16)}
        >
          {fmt(g.plot.w)} × {fmt(g.plot.d)} m
        </text>,
      );
      cy += stepY;
      dataRows.push(
        <text key="l3" className="plate-row-label" x={cx} y={cy}>
          {c.built}
        </text>,
        <text
          key="v3"
          className={`plate-row-value${variant === 'hero' ? ' is-big' : ''}`}
          x={cx}
          y={cy + (variant === 'hero' ? 18 : 16)}
        >
          {g.built ? `${fmt(g.built.area)} m²` : '—'}
        </text>,
      );
      if (variant === 'hero') {
        cy += stepY;
        dataRows.push(
          <text key="l4" className="plate-row-label" x={cx} y={cy}>
            {c.density}
          </text>,
          <text key="v4" className="plate-row-value is-big" x={cx} y={cy + 18}>
            {g.built && g.density ? `${Math.round(g.density * 100)}%` : '—'}
          </text>,
        );
        cy += stepY;
        dataRows.push(
          <text key="l5" className="plate-row-label" x={cx} y={cy}>
            {c.open}
          </text>,
          <text key="v5" className="plate-row-value is-big" x={cx} y={cy + 18}>
            {fmt(g.open)} m²
          </text>,
        );
      }
    } else {
      dataRows.push(
        <text key="l1" className="plate-row-label" x={cx} y={cy}>
          {c.unit}
        </text>,
        <text
          key="v1"
          className={`plate-row-value${variant === 'hero' ? ' is-big' : ''}`}
          x={cx}
          y={cy + (variant === 'hero' ? 18 : 16)}
        >
          {fmt(g.land)} m²
        </text>,
      );
      cy += stepY;
      dataRows.push(
        <text key="l2" className="plate-row-label" x={cx} y={cy}>
          {c.dims}
        </text>,
        <text
          key="v2"
          className={`plate-row-value${variant === 'hero' ? ' is-big' : ''}`}
          x={cx}
          y={cy + (variant === 'hero' ? 18 : 16)}
        >
          {fmt(g.built!.w)} × {fmt(g.built!.d)} m
        </text>,
      );
    }
  }

  /* Title strip */
  let titleStrip: JSX.Element | null = null;
  if (text && sheet.strip) {
    const sy = sheet.strip;
    const barW = 10 * sheet.ppm;
    const labelW = 26;
    const barX = sheet.w - sheet.plan.x - barW - labelW;
    const barY = sy + (variant === 'hero' ? 14 : 12);
    titleStrip = (
      <g>
        <path
          d={`M 0 ${sy} H ${sheet.w}`}
          stroke="var(--border-soft)"
          strokeWidth={1}
          fill="none"
        />
        <text
          className="plate-title"
          x={sheet.plan.x}
          y={sy + (variant === 'hero' ? 18 : 16)}
        >
          {g.plot ? c.site : c.unit}
        </text>
        <g stroke="var(--field-border)" strokeWidth={1} fill="none">
          <path d={`M ${fmtpx(barX)} ${fmtpx(barY)} H ${fmtpx(barX + barW)}`} />
          <path
            d={`M ${fmtpx(barX)} ${fmtpx(barY - 4)} V ${fmtpx(barY + 4)}`}
          />
          <path
            d={`M ${fmtpx(barX + barW / 2)} ${fmtpx(barY - 3)} V ${fmtpx(barY + 3)}`}
          />
          <path
            d={`M ${fmtpx(barX + barW)} ${fmtpx(barY - 4)} V ${fmtpx(barY + 4)}`}
          />
        </g>
        <text
          className="plate-dim"
          x={fmtpx(barX + barW + 6)}
          y={fmtpx(barY + 3.5)}
        >
          10 m
        </text>
      </g>
    );
  }

  const ariaLabel = labelParts.join(', ');

  return (
    <svg
      className={`plate plate-${variant}`}
      viewBox={`0 0 ${sheet.w} ${sheet.h}`}
      preserveAspectRatio="xMidYMid meet"
      focusable="false"
      role="img"
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id={`pt${uid}`}
          width={7}
          height={7}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path
            d="M 0 0 V 7"
            stroke="var(--border)"
            strokeWidth={1}
            fill="none"
          />
        </pattern>
      </defs>
      <rect
        className="plate-sheet"
        x={0}
        y={0}
        width={sheet.w}
        height={sheet.h}
      />
      {text && (
        <g stroke="var(--border-soft)" strokeWidth={1} fill="none">
          {gridLines}
        </g>
      )}
      {accessLine}
      {plotRect}
      {builtRect}
      {dimH}
      {dimV}
      {northArrow}
      {dataRows}
      {titleStrip}
    </svg>
  );
}

/** Caption for card/hero variants. */
export function PlateCaption({ locale }: { locale: Locale }) {
  const c = plateCopy(locale);
  return <p className="plate-caption">{c.caption}</p>;
}

function fmtpx(v: number): number {
  return Math.round(v * 100) / 100;
}
