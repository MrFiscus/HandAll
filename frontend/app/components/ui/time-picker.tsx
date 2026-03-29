import { useState } from "react";
import { Label } from "./label";

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const PERIOD_OPTIONS = ["AM", "PM"] as const;

type PeriodOption = (typeof PERIOD_OPTIONS)[number];

function parseTimeValue(value: string) {
  const [rawHour = "7", rawMinute = "0"] = value.split(":");
  const hour24 = Math.max(0, Math.min(23, Number(rawHour) || 0));
  const minute = Math.max(0, Math.min(59, Number(rawMinute) || 0));
  const period: PeriodOption = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, minute, period };
}

function to24HourString(hour12: number, minute: number, period: PeriodOption) {
  const normalizedHour = hour12 % 12;
  const hour24 = period === "PM" ? normalizedHour + 12 : normalizedHour;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cycleOption<T>(options: readonly T[], current: T, direction: 1 | -1) {
  const index = options.indexOf(current);
  const nextIndex = (index + direction + options.length) % options.length;
  return options[nextIndex];
}

function stepOption<T>(options: readonly T[], current: T, direction: 1 | -1) {
  const index = options.indexOf(current);
  const nextIndex = Math.max(0, Math.min(options.length - 1, index + direction));
  return options[nextIndex];
}

function getVisibleOptions<T>(options: readonly T[], current: T, radius = 2) {
  const index = options.indexOf(current);
  return Array.from({ length: radius * 2 + 1 }, (_, offset) => {
    const nextIndex = (index + offset - radius + options.length) % options.length;
    return options[nextIndex];
  });
}

export function TimePickerField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { hour12, minute, period } = parseTimeValue(value);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState({ hour12, minute, period });

  const openPicker = () => {
    setDraft(parseTimeValue(value));
    setIsOpen(true);
  };

  const updateDraft = (
    key: "hour12" | "minute" | "period",
    nextValue: number | PeriodOption,
  ) => {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  };

  const commitDraft = () => {
    onChange(to24HourString(draft.hour12, draft.minute, draft.period));
    setIsOpen(false);
  };

  const selectionClass =
    "absolute inset-x-0 top-1/2 h-16 -translate-y-1/2 rounded-[1.35rem] border border-white/15 bg-white/80 shadow-[0_10px_40px_rgba(15,23,42,0.12)]";

  const renderColumn = <T extends number | string>({
    options,
    selected,
    onSelect,
    formatter,
    loop = true,
  }: {
    options: readonly T[];
    selected: T;
    onSelect: (value: T) => void;
    formatter: (value: T) => string;
    loop?: boolean;
  }) => {
    const visible = loop
      ? getVisibleOptions(options, selected)
      : Array.from({ length: 5 }, (_, index) => {
          const selectedIndex = options.indexOf(selected);
          const optionIndex = selectedIndex + index - 2;
          return optionIndex >= 0 && optionIndex < options.length
            ? options[optionIndex]
            : null;
        });

    return (
      <div
        className="relative h-52 overflow-hidden"
        onWheel={(event) => {
          event.preventDefault();
          onSelect(
            loop
              ? cycleOption(options, selected, event.deltaY > 0 ? 1 : -1)
              : stepOption(options, selected, event.deltaY > 0 ? 1 : -1),
          );
        }}
      >
        <div className={selectionClass} />
        <div className="relative z-10 flex h-full flex-col items-center justify-center">
          {visible.map((option, index) => {
            const distance = Math.abs(index - 2);
            const isSelected = distance === 0;
            if (option === null) {
              return <div key={`${id}-empty-${index}`} className="h-16 w-full" />;
            }
            return (
              <button
                key={`${id}-${formatter(option)}-${index}`}
                type="button"
                onClick={() => onSelect(option)}
                className={`flex h-16 w-full items-center justify-center text-center font-semibold transition-all ${
                  isSelected
                    ? "text-[2rem] text-slate-900"
                    : distance === 1
                      ? "text-[1.7rem] text-slate-400"
                      : "text-[1.55rem] text-slate-300"
                }`}
              >
                {formatter(option)}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <Label
        htmlFor={id}
        className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80"
      >
        {label}
      </Label>
      <button
        id={id}
        type="button"
        onClick={openPicker}
        className="flex h-14 w-full items-center justify-between rounded-[1.1rem] border-2 border-foreground/10 bg-black/10 px-4 text-left text-foreground transition-colors hover:border-primary/35 hover:bg-black/14"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className="text-base font-semibold text-foreground">
          {`${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`}
        </span>
        <span className="text-sm text-muted-foreground">Select time</span>
      </button>
      <p className="text-sm text-muted-foreground">Tap to open a compact time picker.</p>

      {isOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Select ${label.toLowerCase()}`}
            className="w-full max-w-[420px] rounded-[2rem] border border-white/10 bg-white px-5 py-6 text-slate-900 shadow-[0_28px_80px_rgba(15,23,42,0.35)] sm:px-7"
          >
            <div className="mb-5 text-center">
              <p
                className="text-[2rem] font-semibold tracking-tight"
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  color: "#2c7a4b",
                }}
              >
                Select time
              </p>
            </div>

            <div className="mx-auto grid max-w-[360px] grid-cols-[1fr_24px_1fr_96px] items-center gap-2">
              {renderColumn({
                options: HOUR_OPTIONS,
                selected: draft.hour12,
                onSelect: (next) => updateDraft("hour12", next),
                formatter: (next) => String(next).padStart(2, "0"),
              })}
              <div className="flex h-full items-center justify-center text-[2rem] font-semibold text-slate-400">
                :
              </div>
              {renderColumn({
                options: MINUTE_OPTIONS,
                selected: draft.minute,
                onSelect: (next) => updateDraft("minute", next),
                formatter: (next) => String(next).padStart(2, "0"),
              })}
              {renderColumn({
                options: PERIOD_OPTIONS,
                selected: draft.period,
                onSelect: (next) => updateDraft("period", next),
                formatter: (next) => next,
                loop: false,
              })}
            </div>

            <div className="mt-6 flex items-center justify-between px-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-lg font-medium text-slate-700 transition-colors hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitDraft}
                className="text-lg font-semibold text-slate-900 transition-colors hover:text-slate-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
