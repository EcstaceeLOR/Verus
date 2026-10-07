interface VerusLogoProps {
  readonly compact?: boolean;
}

export function VerusLogo({ compact = false }: VerusLogoProps) {
  return (
    <div className="brand">
      <svg
        className="brand-mark"
        viewBox="0 0 44 44"
        role="img"
        aria-label="Verus shield and verification mark"
      >
        <path
          className="brand-mark__field"
          d="M22 2.75 38.45 8.8v11.86c0 9.7-6.35 17.13-16.45 20.59C11.9 37.79 5.55 30.36 5.55 20.66V8.8L22 2.75Z"
        />
        <path className="brand-mark__gate" d="M11.8 15.1h20.4" />
        <path className="brand-mark__check" d="m13.8 21.25 6.2 7.1 11-13.2" />
      </svg>
      {!compact ? (
        <span className="brand-copy">
          <strong>Verus</strong>
          <small>Context firewall</small>
        </span>
      ) : null}
    </div>
  );
}
