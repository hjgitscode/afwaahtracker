/**
 * Large, low-opacity geometric shapes behind every page (pointer-events: none).
 */
export default function BackgroundShapes() {
  return (
    <div className="bg-geometry" aria-hidden="true">
      {/* large outlined circle partly outside the left edge */}
      <div className="absolute rounded-full" style={{ width: 620, height: 620, left: -300, top: 90, border: '70px solid rgba(74,115,153,.07)' }} />
      {/* second large circle lower left */}
      <div className="absolute rounded-full" style={{ width: 420, height: 420, left: 60, bottom: -260, border: '2px solid rgba(74,115,153,.14)', background: 'rgba(255,255,255,.28)' }} />
      {/* rotated rounded rectangle partly outside right edge */}
      <div className="absolute" style={{ width: 460, height: 460, right: -220, top: 140, borderRadius: 72, transform: 'rotate(24deg)', background: 'rgba(108,151,190,.10)', border: '2px solid rgba(255,255,255,.45)' }} />
      {/* soft irregular blob */}
      <svg className="absolute" style={{ right: '16%', bottom: -120, width: 520, opacity: 0.9 }} viewBox="0 0 200 200">
        <path fill="rgba(255,255,255,.42)" d="M43.8,-58.9C56.3,-50.4,65.8,-37.1,70.6,-22.1C75.4,-7.2,75.5,9.4,69.5,23.3C63.5,37.2,51.3,48.4,37.5,57.5C23.7,66.6,8.3,73.6,-7.9,73.9C-24.1,74.2,-41.2,67.8,-53.5,56.4C-65.8,45,-73.2,28.6,-74.6,12C-76,-4.5,-71.4,-21.2,-62.2,-34.3C-53,-47.4,-39.2,-56.9,-25.1,-64.6C-11,-72.3,3.3,-78.1,17.1,-75.5C30.9,-72.9,31.3,-67.4,43.8,-58.9Z" transform="translate(100 100)" />
      </svg>
      {/* horizontal capsule */}
      <div className="absolute rounded-full" style={{ width: 380, height: 96, left: '38%', top: 34, background: 'rgba(108,151,190,.09)' }} />
      {/* vertical capsule */}
      <div className="absolute rounded-full" style={{ width: 90, height: 330, right: '9%', bottom: 60, border: '2px solid rgba(74,115,153,.12)', background: 'rgba(255,255,255,.25)' }} />
      {/* small solid circles */}
      <div className="absolute rounded-full" style={{ width: 28, height: 28, left: '30%', bottom: '18%', background: 'rgba(79,143,216,.20)' }} />
      <div className="absolute rounded-full" style={{ width: 14, height: 14, right: '28%', top: 120, background: 'rgba(94,199,234,.35)' }} />
    </div>
  );
}

export function Watermark({ word, className = '', style }) {
  return (
    <div className={`watermark ${className}`} style={style} aria-hidden="true">
      {word}
    </div>
  );
}
