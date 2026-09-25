import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size ?? 20}
      height={size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPhone = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </Svg>
);
export const IconPlus = ({ size, ...r }: P) => (
  <Svg size={size} {...r} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconHome = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Svg>
);
export const IconList = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 10h6M9 14h6M9 18h3" />
  </Svg>
);
export const IconBuilding = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
  </Svg>
);
export const IconUser = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Svg>
);
export const IconArrowLeft = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const IconChevron = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IconWarning = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M12 3 2 20h20z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);
export const IconCheck = ({ size, ...r }: P) => (
  <Svg size={size} {...r} strokeWidth={3.5}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);
export const IconCamera = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
export const IconShare = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4" />
  </Svg>
);
export const IconUsers = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c-.6-2.6-2-4.3-4-5" />
  </Svg>
);
export const IconThermo = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a3.5 3.5 0 1 1-4 0z" />
  </Svg>
);
export const IconDrop = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </Svg>
);
export const IconBulb = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" />
  </Svg>
);
export const IconBroom = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
  </Svg>
);
export const IconElevator = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M9 9l3-3 3 3M9 15l3 3 3-3" />
  </Svg>
);
export const IconWrench = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M14 4l6 6-8 8H6v-6z" />
    <path d="M4 21h16" />
  </Svg>
);
export const IconCopy = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </Svg>
);
export const IconClock = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconFire = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-1.5.5-2.5 1.5-3.5.3 1 .8 1.6 1.5 2 .5-3 0-5 1-7.5z" />
  </Svg>
);
export const IconSearch = ({ size, ...r }: P) => (
  <Svg size={size} {...r}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
