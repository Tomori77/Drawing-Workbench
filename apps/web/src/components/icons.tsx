import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconDashboard(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Base>
  );
}

export function IconBrush(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9.5 14.5 3.5 20.5" />
      <path d="M14 4.5 19.5 10l-7 7-5.5-5.5z" />
      <path d="M14 4.5c1-1 2.5-1 3.5 0l2 2c1 1 1 2.5 0 3.5" />
    </Base>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </Base>
  );
}

export function IconGallery(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 16 4.5-4.5a2 2 0 0 1 2.8 0L16 16" />
      <path d="m14 14 1.5-1.5a2 2 0 0 1 2.8 0L21 15" />
      <path d="M8 20h8" />
    </Base>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function IconKey(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8" />
      <path d="m17 4 3 3" />
      <path d="m14 7 3 3" />
    </Base>
  );
}

export function IconLog(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </Base>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Base>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4.5" y="10" width="15" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Base>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </Base>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m14 6-6 6 6 6" />
    </Base>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 5.5v13l11-6.5z" />
    </Base>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Base>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </Base>
  );
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </Base>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="m9 14.5 2 2 4-4" />
    </Base>
  );
}

export function IconServer(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4" width="17" height="7" rx="2" />
      <rect x="3.5" y="13" width="17" height="7" rx="2" />
      <path d="M7 7.5h.01" />
      <path d="M7 16.5h.01" />
    </Base>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Base>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </Base>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h2" />
      <path d="M10 12h10" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 18h8" />
      <path d="M16 18h4" />
      <circle cx="14" cy="18" r="2" />
    </Base>
  );
}

export function IconLogo(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="16" rx="4" />
      <path d="M7.5 15c1.5-4 3-6 4.5-6s3 2 4.5 6" />
      <circle cx="12" cy="9.5" r="0.8" fill="currentColor" stroke="none" />
    </Base>
  );
}
