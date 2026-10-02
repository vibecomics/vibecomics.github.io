const icon = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function TrashIcon() {
  return (
    <svg {...icon}>
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9.2a1 1 0 0 0 1 .8h4.8a1 1 0 0 0 1-.8L12 4M6.5 6.5v5M9.5 6.5v5" />
    </svg>
  );
}

/** A big sparkle beside a small one: generate. */
export function SparklesIcon() {
  return (
    <svg {...icon} fill="currentColor" stroke="none">
      <path d="M7 1.5c.3 2.2 1 3.7 1.9 4.6S11 7.7 13.2 8c-2.2.3-3.7 1-4.6 1.9S7.3 12.8 7 15c-.3-2.2-1-3.7-1.9-4.6S2.2 9.3 0 9c2.2-.3 3.7-1 4.6-1.9S6.7 3.7 7 1.5z" />
      <path d="M13 9c.15 1 .5 1.65.9 2.05s1.05.75 2.05.9c-1 .15-1.65.5-2.05.9s-.75 1.05-.9 2.05c-.15-1-.5-1.65-.9-2.05s-1.05-.75-2.05-.9c1-.15 1.65-.5 2.05-.9s.75-1.05.9-2.05z" />
    </svg>
  );
}

/** Two halves of a shape either side of a dashed axis: mirrors left to right. */
export function FlipIcon() {
  return (
    <svg {...icon}>
      <path d="M8 2v12" strokeDasharray="1.5 2" />
      <path d="M6 4.5 2 12h4zM10 4.5 14 12h-4z" />
    </svg>
  );
}

/** Two arrows chasing each other in a circle: reload. */
export function RefreshIcon() {
  return (
    <svg {...icon}>
      <path d="M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4M12 1.8v3h-3M4 14.2v-3h3" />
    </svg>
  );
}

/** A box with an arrow leaving it: opens something in a new tab. */
export function ExternalIcon() {
  return (
    <svg {...icon}>
      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" />
    </svg>
  );
}

/** Points right; `open` turns it down (a row is expanded). */
export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg {...icon} style={{ transform: open ? 'rotate(90deg)' : undefined }}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/** Scissors with the blades pointing right; `turn` rotates it in degrees (90 points them down). */
export function ScissorsIcon({ turn = 0 }: { turn?: number }) {
  return (
    <svg {...icon} width={18} height={18} style={{ transform: `rotate(${turn}deg)` }}>
      <circle cx="3.2" cy="4.4" r="1.7" />
      <circle cx="3.2" cy="11.6" r="1.7" />
      <path d="M4.6 5.4 14.5 10.8M4.6 10.6 14.5 5.2" />
    </svg>
  );
}
