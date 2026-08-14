// The Dashboards product mark: panels on a board, blue brand.
export function DbMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="5" width="24" height="22" rx="4" fill="#EFF6FF" stroke="#2563EB" strokeWidth="1.8" />
      <rect x="8" y="16" width="4" height="7" rx="1" fill="#93C5FD" />
      <rect x="14" y="12" width="4" height="11" rx="1" fill="#3B82F6" />
      <rect x="20" y="9" width="4" height="14" rx="1" fill="#2563EB" />
    </svg>
  );
}
