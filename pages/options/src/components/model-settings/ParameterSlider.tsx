import { NUMBER_INPUT_CLASS, PARAMETER_SAVE_DEBOUNCE_MS } from './constants';
import type { ParameterChangeOptions } from './types';

interface ParameterSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  numberAriaLabel: string;
  onChange: (value: number, options: ParameterChangeOptions) => void;
}

/** Range slider paired with a number input. The slider is debounced; typed numbers save immediately. */
export function ParameterSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  decimals,
  numberAriaLabel,
  onChange,
}: ParameterSliderProps) {
  const fillPercent = (value / max) * 100;

  return (
    <div className="flex items-center">
      <label htmlFor={id} className="w-24 text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="flex flex-1 items-center space-x-2">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number.parseFloat(e.target.value), { debounceMs: PARAMETER_SAVE_DEBOUNCE_MS })}
          style={{
            background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${fillPercent}%, var(--input) ${fillPercent}%, var(--input) 100%)`,
          }}
          className="h-1 flex-1 appearance-none rounded-full accent-primary"
        />
        <div className="flex items-center space-x-2">
          <span className="w-12 text-sm text-muted-foreground">{value.toFixed(decimals)}</span>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => {
              const typedValue = Number.parseFloat(e.target.value);
              if (!Number.isNaN(typedValue) && typedValue >= min && typedValue <= max) {
                onChange(typedValue, { debounceMs: 0 });
              }
            }}
            className={NUMBER_INPUT_CLASS}
            aria-label={numberAriaLabel}
          />
        </div>
      </div>
    </div>
  );
}
