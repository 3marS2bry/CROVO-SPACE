import React from 'react';
import {
  Bell,
  Crown,
  Flame,
  Gift,
  Info,
  Megaphone,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Zap,
} from 'lucide-react';
import type { AdIconName } from '../../utils/adSystem';

interface AdIconProps {
  name: AdIconName;
  sizePx?: number;
  color?: string;
  className?: string;
}

export const AdIcon: React.FC<AdIconProps> = ({
  name,
  sizePx = 18,
  color,
  className = '',
}) => {
  if (name === 'none') return null;

  const style: React.CSSProperties = {
    width: `${sizePx}px`,
    height: `${sizePx}px`,
    color: color || undefined,
  };

  const commonProps = {
    style,
    className: `shrink-0 ${className}`.trim(),
    'aria-hidden': true as const,
  };

  switch (name) {
    case 'zap':
      return <Zap {...commonProps} />;
    case 'megaphone':
      return <Megaphone {...commonProps} />;
    case 'tag':
      return <Tag {...commonProps} />;
    case 'gift':
      return <Gift {...commonProps} />;
    case 'bell':
      return <Bell {...commonProps} />;
    case 'flame':
      return <Flame {...commonProps} />;
    case 'shield':
      return <ShieldCheck {...commonProps} />;
    case 'star':
      return <Star {...commonProps} />;
    case 'rocket':
      return <Rocket {...commonProps} />;
    case 'crown':
      return <Crown {...commonProps} />;
    case 'info':
      return <Info {...commonProps} />;
    case 'sparkles':
    default:
      return <Sparkles {...commonProps} />;
  }
};
