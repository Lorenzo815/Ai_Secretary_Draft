/**
 * Oria Logo — orbital/conversational abstract symbol + wordmark.
 *
 * The symbol is a single continuous stroke forming an open orbit
 * with a subtle inflection that suggests conversation flow.
 */

export function OriaSymbol({
  className = "h-8 w-8",
  color = "currentColor",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Orbital ring — open circle with conversation inflection */}
      <path
        d="M20 4C11.163 4 4 11.163 4 20s7.163 16 16 16c6.627 0 12.283-4.03 14.708-9.77"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Inner decision point — intelligence node */}
      <circle cx="20" cy="20" r="3" fill={color} />
      {/* Flow tail — suggests entry/exit of information */}
      <path
        d="M34.708 10.23C32.283 4.49 26.627 4 20 4"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 4"
      />
    </svg>
  );
}

export function OriaWordmark({
  className = "text-2xl",
  color,
}: {
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={`font-heading font-semibold tracking-tight ${className}`}
      style={color ? { color } : undefined}
    >
      Oria
    </span>
  );
}

export function OriaLogo({
  className = "",
  size = "default",
}: {
  className?: string;
  size?: "small" | "default" | "large";
}) {
  const sizes = {
    small: { symbol: "h-6 w-6", text: "text-lg" },
    default: { symbol: "h-8 w-8", text: "text-2xl" },
    large: { symbol: "h-12 w-12", text: "text-4xl" },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <OriaSymbol className={s.symbol} color="#0F766E" />
      <OriaWordmark className={`${s.text} text-slate-ink`} />
    </div>
  );
}

export function OriaLogoLight({
  className = "",
  size = "default",
}: {
  className?: string;
  size?: "small" | "default" | "large";
}) {
  const sizes = {
    small: { symbol: "h-6 w-6", text: "text-lg" },
    default: { symbol: "h-8 w-8", text: "text-2xl" },
    large: { symbol: "h-12 w-12", text: "text-4xl" },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <OriaSymbol className={s.symbol} color="#FCFAF6" />
      <OriaWordmark className={`${s.text} text-soft-ivory`} />
    </div>
  );
}
