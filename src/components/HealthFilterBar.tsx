import React from 'react';

export type HealthFilterTone = 'neutral' | 'healthy' | 'warning' | 'critical';

export type HealthFilterOption<T extends string> = {
  value: T;
  label: string;
  count: number;
  tone?: HealthFilterTone;
};

export function HealthFilterBar<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: HealthFilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="services-filter-group" aria-label={label} role="group">
      {options.map(option => {
        const active = option.value === value;
        const tone = option.tone || 'neutral';
        return (
          <button
            type="button"
            key={option.value}
            className={`${active ? 'active' : ''} ${tone}`}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
          >
            <i />
            {option.label}
            <span>{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}
