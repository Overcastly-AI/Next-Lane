/** Toolbar glyphs — 16px, 2px stroke, round caps (matches the app's inline SVG set). */
import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const BoldIcon = () => (
  <Svg>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  </Svg>
);
export const ItalicIcon = () => (
  <Svg>
    <path d="M19 4h-9M14 20H5M15 4 9 20" />
  </Svg>
);
export const StrikeIcon = () => (
  <Svg>
    <path d="M16 4H9.5a3.5 3.5 0 0 0 0 7M4 12h16M8 20h6.5a3.5 3.5 0 0 0 2.4-6" />
  </Svg>
);
export const CodeIcon = () => (
  <Svg>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Svg>
);
export const LinkIcon = () => (
  <Svg>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);
export const BulletListIcon = () => (
  <Svg>
    <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);
export const OrderedListIcon = () => (
  <Svg>
    <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
  </Svg>
);
export const TaskListIcon = () => (
  <Svg>
    <path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8" />
  </Svg>
);
export const QuoteIcon = () => (
  <Svg>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.3-.9-2-2-2H4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4M15 21c3 0 7-1 7-8V5c0-1.3-.9-2-2-2h-4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4" />
  </Svg>
);
export const CodeBlockIcon = () => (
  <Svg>
    <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM10 9l-3 3 3 3M14 9l3 3-3 3" />
  </Svg>
);
export const TableIcon = () => (
  <Svg>
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M3 15h18M9 3v18" />
  </Svg>
);
export const ImageIcon = () => (
  <Svg>
    <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21" />
  </Svg>
);
export const AtIcon = () => (
  <Svg>
    <path d="M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </Svg>
);
export const MinusIcon = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
);
