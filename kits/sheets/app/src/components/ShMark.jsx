// The Sheets product mark: a small grid, emerald brand.
export function ShMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="5" width="24" height="22" rx="4" fill="#ECFDF5" stroke="#059669" strokeWidth="1.8" />
      <line x1="4" y1="12" x2="28" y2="12" stroke="#059669" strokeWidth="1.6" />
      <line x1="12" y1="5" x2="12" y2="27" stroke="#059669" strokeWidth="1.6" />
      <rect x="14" y="14" width="12" height="4" rx="1" fill="#34D399" />
      <rect x="14" y="20" width="8" height="4" rx="1" fill="#A7F3D0" />
    </svg>
  );
}
