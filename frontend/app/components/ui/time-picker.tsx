import { useState } from "react";
import { Label } from "./label";
import { cn } from "./utils";

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
    "absolute inset-x-0 top-1/2 h-16 -translate-y-1/2 rounded-2xl border border-white/10 bg-white/5";

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
        className="relative h-52 overflow-hidden cursor-ns-resize"
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
                className={cn(
                  "flex h-16 w-full items-center justify-center text-center font-bold transition-all duration-300",
                  isSelected
                    ? "text-3xl text-primary scale-110"
                    : distance === 1
                      ? "text-xl text-foreground/40"
                      : "text-lg text-foreground/10"
                )}
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
        className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40"
      >
        {label}
      </Label>
      <button
        id={id}
        type="button"
        onClick={openPicker}
        className="flex h-14 w-full items-center justify-between rounded-2xl bg-white/[0.02] border border-white/5 px-6 text-left text-foreground transition-all hover:bg-white/[0.04] hover:border-white/10"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className="text-base font-bold text-foreground">
          {`${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`}
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest text-primary/40">Change</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm animate-in fade-in duration-300">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Select ${label.toLowerCase()}`}
            className="w-full max-w-[420px] rounded-[2.5rem] border border-white/10 bg-[#1a3a2a] p-10 text-foreground shadow-4xl animate-in zoom-in-95 duration-300"
          >
            <div className="mb-8">
              <p className="text-3xl font-black tracking-tighter">
                {label}.
              </p>
              <p className="text-sm font-medium text-muted-foreground/40 mt-1">Scroll to adjust the time.</p>
            </div>

            <div className="mx-auto grid max-w-[360px] grid-cols-[1fr_24px_1fr_96px] items-center gap-2">
              {renderColumn({
                options: HOUR_OPTIONS,
                selected: draft.hour12,
                onSelect: (next) => updateDraft("hour12", next),
                formatter: (next) => String(next).padStart(2, "0"),
              })}
              <div className="flex h-full items-center justify-center text-3xl font-black text-foreground/20">
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

            <div className="mt-10 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-1 h-14 rounded-2xl font-bold text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitDraft}
                className="flex-1 h-14 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest shadow-2xl transition-all hover:scale-105 active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
