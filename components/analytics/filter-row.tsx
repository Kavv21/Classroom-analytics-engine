"use client";

import { focusRing } from "@/components/analytics/chart-card";

/**
 * One filter row above the charts it scopes (never per-chart filters).
 * Standard HTML form controls; every chart on the page re-renders against
 * the same slice, so the numbers always agree.
 */

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label className="text-xs text-gray-600">
      <span className="mb-0.5 block">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 ${focusRing}`}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="text-xs text-gray-600">
      <span className="mb-0.5 block">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 ${focusRing}`}
      />
    </label>
  );
}

export function ResetFiltersButton({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      className={`self-end rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`}
    >
      Reset filters
    </button>
  );
}

export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}
