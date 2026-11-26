"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface StyledSelectProps<T extends string> {
  id: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabelledBy?: string;
}

export function StyledSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabelledBy,
}: StyledSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedOption =
    options.find((opt) => opt.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const openAndFocus = (index: number) => {
    setOpen(true);
    requestAnimationFrame(() => {
      const clamped = Math.max(0, Math.min(options.length - 1, index));
      optionRefs.current[clamped]?.focus();
    });
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (disabled) return;
    const selectedIndex = Math.max(
      0,
      options.findIndex((opt) => opt.value === value)
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openAndFocus(selectedIndex);
      } else {
        optionRefs.current[0]?.focus();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openAndFocus(selectedIndex);
      } else {
        optionRefs.current[options.length - 1]?.focus();
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      openAndFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      openAndFocus(options.length - 1);
    }
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionRefs.current[(index + 1) % options.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      optionRefs.current[(index - 1 + options.length) % options.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      optionRefs.current[options.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            const idx = Math.max(
              0,
              options.findIndex((opt) => opt.value === value)
            );
            openAndFocus(idx);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className="ui-input flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={ariaLabelledBy}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-control border border-line-input bg-surface py-1 shadow-popover"
        >
          {options.map((opt, index) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value || "__empty"}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, index)}
                className={`flex min-h-[40px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none ${
                  selected
                    ? "bg-accent-soft font-medium text-accent-text"
                    : "text-ink hover:bg-subtle focus-visible:bg-subtle"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {selected && (
                  <Check
                    className="h-4 w-4 shrink-0 text-accent"
                    strokeWidth={2}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

