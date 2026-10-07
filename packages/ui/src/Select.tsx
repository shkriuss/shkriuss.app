import { useId } from "react";

/** One of the options of a `Select`: its value, and its text. */
export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

export interface SelectProps<V extends string> {
  readonly label: string;
  readonly options: readonly SelectOption<V>[];
  /** The option that is selected, by its value. */
  readonly value: V;
  readonly onChange: (value: V) => void;
}

/**
 * A labeled choice of one of a few options, on the browser's own `<select>`, which phones show
 * with their own picker. React Aria's would open a popover that, on iOS, adds a stylesheet to the
 * page, which the Content-Security-Policy refuses.
 */
export function Select<V extends string>({ label, options, value, onChange }: SelectProps<V>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.value === event.target.value);
          if (option !== undefined) {
            onChange(option.value);
          }
        }}
        className="min-h-11 rounded-lg border border-line-strong bg-canvas px-3 text-ink"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
