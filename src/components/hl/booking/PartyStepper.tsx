"use client";

import { useId } from "react";
import { bookingWords as words } from "@/content/booking";

const buttonClass =
  "inline-flex size-11 items-center justify-center rounded-pill border border-ink-2 font-ui text-item font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-rust aria-disabled:cursor-default aria-disabled:opacity-40";

/**
 * How many people: a minus button, the count and a plus button. The buttons stay focusable at the ends (aria-disabled) so a
 * keyboard visitor who reaches a limit is not thrown out of the control. The count is an `output`, announced politely.
 */
export function PartyStepper({ min, max, value, onChange }: { min: number; max: number; value: number; onChange: (value: number) => void }) {
  const id = useId();
  const hint = words.partyHint(min, max);
  return (
    <div role="group" aria-labelledby={`${id}-legend`} aria-describedby={hint ? `${id}-hint` : undefined}>
      <p id={`${id}-legend`} className="font-ui text-label font-medium text-ink">
        {words.partyLegend}
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button type="button" aria-label={words.partyDecrease} aria-disabled={value <= min ? "true" : undefined} onClick={() => value > min && onChange(value - 1)} className={buttonClass}>
          <span aria-hidden="true">&minus;</span>
        </button>
        <output aria-live="polite" className="min-w-24 text-center font-ui text-item font-bold">
          {words.partyOutput(value)}
        </output>
        <button type="button" aria-label={words.partyIncrease} aria-disabled={value >= max ? "true" : undefined} onClick={() => value < max && onChange(value + 1)} className={buttonClass}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-2 text-small text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
