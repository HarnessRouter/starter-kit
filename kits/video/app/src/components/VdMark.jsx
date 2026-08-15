// The Videos product mark: a play triangle on a frame, over a strip of sprocket holes.
//
// kits/video/icon.svg is generated from this component — the console renders the file, the app
// renders the component, and they have to be the same drawing. Change it here and regenerate;
// two copies of a logo diverge the first time one of them is touched.
export function VdMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="5" width="24" height="22" rx="4" fill="#F1EEFF" stroke="#6E55FF" strokeWidth="1.8" />
      <path d="M13.6 10.4 L21.4 15 L13.6 19.6 Z" fill="#6E55FF" />
      <rect x="8" y="22.2" width="5" height="2" rx="1" fill="#6E55FF" />
      <rect x="14.5" y="22.2" width="5" height="2" rx="1" fill="#B9AEFF" />
      <rect x="21" y="22.2" width="3" height="2" rx="1" fill="#B9AEFF" />
    </svg>
  );
}
