"use client";

import { useId } from "react";
import type { Service } from "@/booking/schema";
import { bookingWords as words } from "@/content/booking";
import { lengthText, priceParts } from "@/lib/booking-flow";
import { Text } from "@/components/ui/Text";

/**
 * One card per live service, in one native radio group (arrow keys move between them). The chosen card turns to ink with the
 * site's rust dot, as the gift card amounts do. Each card says what it is, how long, and what it costs and what is taken online.
 */
export function ServiceCards({ services, currency, selected, onSelect }: { services: readonly Service[]; currency: string; selected: string | null; onSelect: (id: string) => void }) {
  const name = useId();
  return (
    <fieldset role="radiogroup" aria-required="true">
      <legend className="block font-ui text-label font-medium text-ink">{words.serviceLegend}</legend>
      <div className={`mt-3 grid gap-3 ${services.length > 1 ? "md:grid-cols-2" : ""}`}>
        {services.map((service) => {
          const on = selected === service.id;
          const price = priceParts(service, currency);
          return (
            <label key={service.id} className="relative flex">
              <input type="radio" name={name} value={service.id} checked={on} onChange={() => onSelect(service.id)} className="peer sr-only" />
              <span
                className={`flex w-full cursor-pointer flex-col rounded-card border p-5 font-ui peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-rust ${
                  on ? "border-ink bg-ink text-silver" : "border-ink-2 text-ink"
                }`}
              >
                <span className="pr-6 text-item font-bold">
                  <Text>{service.name}</Text>
                </span>
                <span className="mt-1.5 font-text text-list">
                  <Text>{service.description}</Text>
                </span>
                <span className="mt-3 text-small font-medium">{lengthText(service)}</span>
                <span className="mt-auto pt-4">
                  <span className="block text-label font-bold">{price.price}</span>
                  {price.terms ? <span className="block text-small font-medium">{price.terms}</span> : null}
                </span>
                {on ? <span aria-hidden="true" className="absolute right-4 top-4 size-2 rounded-pill bg-rust" /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
