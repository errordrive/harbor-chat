/* Inline SVG icons — GistVault style: stroke icons, no emojis. */

const base = (props) => ({
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  ...props,
});

export const IconMenu = (p) => (
  <svg {...base(p)}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
);
export const IconClose = (p) => (
  <svg {...base(p)}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
);
export const IconPlus = (p) => (
  <svg {...base(p)}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
export const IconGear = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
export const IconSun = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /><line x1="4.9" y1="4.9" x2="7" y2="7" /><line x1="17" y1="17" x2="19.1" y2="19.1" /><line x1="4.9" y1="19.1" x2="7" y2="17" /><line x1="17" y1="7" x2="19.1" y2="4.9" /></svg>
);
export const IconMoon = (p) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const IconSend = (p) => (
  <svg {...base(p)}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);
export const IconStop = (p) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></svg>
);
export const IconCopy = (p) => (
  <svg {...base(p)}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
export const IconRefresh = (p) => (
  <svg {...base(p)}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" /></svg>
);
export const IconCheck = (p) => (
  <svg {...base(p)}><polyline points="20 6 9 17 4 12" /></svg>
);
export const IconChevron = (p) => (
  <svg {...base(p)}><polyline points="6 9 12 15 18 9" /></svg>
);
export const IconTrash = (p) => (
  <svg {...base(p)}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);
export const IconBolt = (p) => (
  <svg {...base(p)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);
export const IconArrowDown = (p) => (
  <svg {...base(p)}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
);
export const IconUser = (p) => (
  <svg {...base(p)}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);
export const IconGlobe = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
);
export const IconBot = (p) => (
  <svg {...base(p)}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M8 4h8" /><circle cx="9" cy="14" r="1" fill="currentColor" /><circle cx="15" cy="14" r="1" fill="currentColor" /><path d="M9 17.5h6" /></svg>
);
export const IconLogout = (p) => (
  <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
);
export const IconLogo = (p) => (
  <svg viewBox="0 0 64 64" width={22} height={22} {...p}>
    <rect width="64" height="64" rx="15" fill="#2563EB" />
    <path d="M18 41c4.5-9 13.5-13.5 24-13.5 2.2 0 4.4.3 6.5.9-1.1-6.6-6.6-12-14.3-13.1-8.7-1.2-16.4 4.4-18.6 13.2-1.2 5.4-.1 9.9 2.4 12.5z" fill="#fff" />
    <circle cx="46" cy="21" r="3.2" fill="#BFDBFE" />
  </svg>
);
