/**
 * Button — the ONE button primitive. Variants: gold (primary client action),
 * dark (alt primary), ghost (secondary outline). Renders <button> by default,
 * or <a> when `href` is passed. Locked brand: gold reserved for the primary
 * action, never a solid green/amber block. See ui.css.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './ui.css';

export type ButtonVariant = 'gold' | 'dark' | 'ghost';
export type ButtonSize = 'sm' | 'md';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  children: ReactNode;
  /** When set, renders an anchor instead of a button. */
  href?: string;
};

export default function Button({
  variant = 'gold',
  size = 'md',
  block = false,
  className = '',
  href,
  children,
  ...rest
}: CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  const cls =
    `av-btn av-btn--${variant}` +
    (size === 'sm' ? ' av-btn--sm' : '') +
    (block ? ' av-btn--block' : '') +
    (className ? ` ${className}` : '');

  if (href != null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <a href={href} className={cls} {...(rest as any)}>{children}</a>;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <button className={cls} {...(rest as any)}>{children}</button>;
}
