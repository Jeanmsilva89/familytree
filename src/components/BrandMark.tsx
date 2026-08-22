export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Family Tree mark">
      <rect width="64" height="64" rx="16" fill="#efe3d0" />
      <path d="M32 50 V30" stroke="#6a4d38" strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M32 34c-9-2-14-9-13-16 6 1 11 6 13 11 2-5 7-10 13-11 1 7-4 14-13 16z"
        fill="#3f5d3f"
      />
      <circle cx="24" cy="22" r="3" fill="#dce8d4" />
      <circle cx="40" cy="20" r="2.4" fill="#dce8d4" />
    </svg>
  );
}
