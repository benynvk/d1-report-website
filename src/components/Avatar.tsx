function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

export function Avatar({
  name,
  src,
  size = 32,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img className="avatar" src={src} alt={name} style={style} />
    );
  }
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
