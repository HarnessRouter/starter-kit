// The Slides product mark: a stack of slides, indigo.
export function SlMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="5" y="7" width="22" height="15" rx="2.5" fill="#4F46E5" />
      <rect x="8.5" y="11" width="9" height="1.8" rx="0.9" fill="#fff" opacity="0.95" />
      <rect x="8.5" y="14.5" width="15" height="1.8" rx="0.9" fill="#fff" opacity="0.7" />
      <rect x="8.5" y="18" width="12" height="1.8" rx="0.9" fill="#fff" opacity="0.7" />
      <rect x="11" y="24" width="10" height="2.4" rx="1.2" fill="#A5B4FC" />
    </svg>
  );
}
