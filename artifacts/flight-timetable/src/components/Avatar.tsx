// Round profile avatar: shows the pilot's picture if set, else their initial.
export function Avatar({ url, name, size = 36, className = "" }: { url?: string | null; name?: string | null; size?: number; className?: string }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt={name || "Profile"}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`rounded-full border border-[#e5e7eb] object-cover ${className}`}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        draggable={false}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`flex items-center justify-center rounded-full border border-[#e5e7eb] bg-[#f9fafb] font-black uppercase text-[#1a1a1a] ${className}`}>
      {initial}
    </div>
  );
}
