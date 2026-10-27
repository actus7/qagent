import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../utils';

// One button for every page. Side panel uses the default sizes (shadcn look); options uses `compact`, which keeps
// its original shape: no fixed height, rounded corners, scale on hover, and a muted disabled state.
export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'compact';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE_CLASS =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50';

const STANDARD_CLASS = 'rounded-md text-sm font-medium [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
  outline: 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-8',
  icon: 'size-9',
  compact:
    'rounded px-4 py-1 shadow-sm transition-all hover:scale-105 disabled:pointer-events-auto disabled:scale-100 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none',
};

export function Button({ variant = 'default', size = 'default', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        BASE_CLASS,
        size === 'compact' ? '' : STANDARD_CLASS,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
