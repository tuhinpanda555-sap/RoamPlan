import { useState } from 'react';
import { Compass } from 'lucide-react';

interface EditorialImageProps {
  src?: string;
  alt: string;
  title?: string;
  subtitle?: string;
  coordinatesLabel?: string;
  className?: string;
}

export function EditorialImage({
  src,
  alt,
  title,
  subtitle,
  coordinatesLabel,
  className = '',
}: EditorialImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#EFECE4] via-[#E8E3D8] to-[#DFD9CE] text-[#4B5650] p-8 text-center ${className}`}
      >
        <Compass className="w-8 h-8 mb-3 text-[#1B4B3A]" strokeWidth={1.5} aria-hidden="true" />
        <span className="font-editorial text-2xl text-[#17211C]">{title || alt}</span>
        {subtitle && <span className="text-sm text-[#4B5650] mt-1">{subtitle}</span>}
        {coordinatesLabel && (
          <span className="font-mono tabular-nums text-xs text-[#4B5650] mt-2">
            {coordinatesLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
