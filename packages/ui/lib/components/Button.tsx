import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../utils';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export type ButtonProps = {
  variant?: ButtonVariant;
  disabled?: boolean;
} & ComponentPropsWithoutRef<'button'>;

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
  danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
};

export function Button({ variant = 'primary', className, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'py-1 px-4 rounded shadow transition-all',
        disabled ? 'cursor-not-allowed bg-muted text-muted-foreground' : cn(variantClasses[variant], 'hover:scale-105'),
        className,
      )}
      disabled={disabled}
      {...props}>
      {children}
    </button>
  );
}
