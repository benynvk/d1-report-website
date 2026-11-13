/** Small stroke icons shared by the management pages (16px by default). */
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

type P = { size?: number };

export const EditIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);
export const TrashIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);
export const ChevronLeft = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);
export const ChevronRight = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const ExternalIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const CloseIcon = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const BellIcon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);
export const ChatIcon = ({ size = 13 }: P) => (
  <svg {...base(size)}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
  </svg>
);
