/**
 * Card — the ONE card primitive. Cream/white surface, hairline emerald border,
 * crisp radius, one quiet shadow. Pass `hover` for the consistent -3px lift
 * (reduced-motion safe). See ui.css.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import './ui.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the consistent hover lift (use for clickable/interactive cards). */
  hover?: boolean;
  children: ReactNode;
}

export default function Card({ hover = false, className = '', children, ...rest }: CardProps) {
  const cls = `av-card${hover ? ' av-card--hover' : ''}${className ? ` ${className}` : ''}`;
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
