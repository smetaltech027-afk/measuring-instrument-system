interface InstrumentPlaceholderProps {
  name: string;
  code: string;
}

function classifyInstrumentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('vernier') || lower.includes('caliper')) return 'VERNIER CALIPER';
  if (lower.includes('micro')) return 'MICROMETER';
  if (lower.includes('holtest') || lower.includes('t- point') || lower.includes('t-point')) {
    return 'HOLTEST';
  }
  if (lower.includes('dial')) return 'DIAL GAUGE';
  if (lower.includes('plug')) return 'PLUG GAUGE';
  if (lower.includes('high') || lower.includes('height')) return 'HEIGHT GAUGE';
  if (lower.includes('chamfer')) return 'CHAMFER GAUGE';
  return 'MEASURING TOOL';
}

/**
 * Neutral precision-workshop placeholder illustration shown when an instrument
 * does not yet have a confirmed photo uploaded. Never substitutes another tool's photo.
 */
export function InstrumentPlaceholder({ name, code }: InstrumentPlaceholderProps) {
  const category = classifyInstrumentType(name);

  return (
    <svg
      viewBox="0 0 320 240"
      width={320}
      height={240}
      role="img"
      aria-label={`ภาพแทนชั่วคราวสำหรับ ${name} รหัส ${code}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <rect width="320" height="240" fill="#EEF2FF" />
      {/* Subtle blueprint grid */}
      <g stroke="#D5DCF0" strokeWidth="1">
        <path d="M0 40H320M0 80H320M0 120H320M0 160H320M0 200H320" />
        <path d="M40 0V240M80 0V240M120 0V240M160 0V240M200 0V240M240 0V240M280 0V240" />
      </g>

      {/* Precision caliper vector mark */}
      <g transform="translate(86, 56)" stroke="#1E3A8A" strokeWidth="2.4" fill="none">
        <rect x="0" y="22" width="148" height="20" rx="3" fill="#FFFFFF" />
        <path d="M18 42v34l12-10V42" fill="#E0E7FF" />
        <path d="M52 42v30l12-9V42" fill="#FFFFFF" />
        <path d="M18 22V8l10 5v9" fill="#FFEDD5" stroke="#EA580C" />
        <path d="M52 22V10l10 5v7" fill="#FFFFFF" />
        <g stroke="#172554" strokeWidth="1.5">
          <line x1="76" y1="22" x2="76" y2="30" />
          <line x1="88" y1="22" x2="88" y2="28" />
          <line x1="100" y1="22" x2="100" y2="32" />
          <line x1="112" y1="22" x2="112" y2="28" />
          <line x1="124" y1="22" x2="124" y2="30" />
          <line x1="136" y1="22" x2="136" y2="28" />
        </g>
      </g>

      {/* Code pill & caption */}
      <rect x="86" y="156" width="148" height="28" rx="6" fill="#1E3A8A" />
      <text
        x="160"
        y="175"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="13"
        fontWeight="600"
        fontFamily="IBM Plex Mono, monospace"
      >
        {code}
      </text>
      <text
        x="160"
        y="204"
        textAnchor="middle"
        fill="#3B4B75"
        fontSize="11"
        fontWeight="600"
        fontFamily="IBM Plex Sans Thai, sans-serif"
      >
        {category} • ภาพแทนชั่วคราว
      </text>
    </svg>
  );
}
