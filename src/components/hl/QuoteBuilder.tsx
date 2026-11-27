"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatRange, priceRange } from "@/catalog/price";
import type { PriceItem, PricingTable } from "@/catalog/schema";
import { catalogWords } from "@/content/catalog";
import { providers } from "@/content/providers";
import type { PublicForm } from "@/forms/schema";
import { track } from "@/tracking/track";
import { rangeWords } from "./catalog-data";
import { itemWords } from "./catalog-words";
import { FormView, type FormSelection } from "./FormView";
import { TextLink } from "./TextLink";

/** What the builder needs of a piece: its slug and name, and what the price function reads. */
export type BuilderItem = { slug: string; name: string } & Required<Pick<PriceItem, "price" | "options" | "perPerson">>;

type Props = {
  pricing: PricingTable;
  items: readonly BuilderItem[];
  /** The piece chosen when the panel appears, or null to make the visitor pick one from a list first. */
  initialSlug: string | null;
  itemWord: { singular: string; plural: string };
  quote: { id: string; form: PublicForm } | null;
  /** The heading level of the form's heading, one below the heading above the panel. */
  headingLevel: "h2" | "h3";
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/**
 * The quote builder (spec R13): one chip per choice of each option group the piece uses, a stepper for the people when the
 * piece takes the per-person fee, and the estimate in large type, worked out in the browser with the same function the
 * Worker uses. "Request this quote" opens the quote form in place under a summary and moves focus to its heading. What is
 * sent is the selection only; the Worker works out the price again and ignores any figure from the browser.
 */
export function QuoteBuilder({ pricing, items, initialSlug, itemWord, quote, headingLevel }: Props) {
  const prefix = useId();
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // The box starts at the smallest party, so the number the estimate uses is always on screen.
  const [peopleText, setPeopleText] = useState(() => {
    const first = items.find((candidate) => candidate.slug === initialSlug);
    return first !== undefined && first.perPerson && pricing.perPerson !== null ? String(pricing.perPerson.min) : "";
  });
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<HTMLButtonElement>(null);
  const item = items.find((candidate) => candidate.slug === slug) ?? null;
  const fee = item !== null && item.perPerson ? pricing.perPerson : null;
  const Heading = headingLevel;

  // Opening moves focus to the form's heading; closing with "Change my selection" returns it to the button.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (open) headingRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      requestRef.current?.focus();
    }
  }, [open]);

  const people = fee === null ? undefined : clamp(Number.isNaN(Number.parseInt(peopleText, 10)) ? fee.min : Number.parseInt(peopleText, 10), fee.min, fee.max);
  const groups = item === null ? [] : item.options.flatMap((id) => pricing.groups.filter((group) => group.id === id));
  const options = Object.fromEntries(groups.map((group) => [group.id, chosen[group.id] ?? group.choices[0]?.id ?? ""]));
  const priced = item === null ? null : priceRange(item, pricing, { options, ...(people === undefined ? {} : { people }) }, item.slug);
  const range = priced !== null && priced.ok ? formatRange(priced.result, pricing.currency, rangeWords) : null;
  const selection: FormSelection | null = item === null ? null : { item: item.slug, options, ...(people === undefined ? {} : { people }) };

  function pick(next: string) {
    const found = items.find((candidate) => candidate.slug === next);
    setSlug(found ? found.slug : null);
    setChosen({});
    setOpen(false);
    setSent(false);
    setPeopleText(found !== undefined && found.perPerson && pricing.perPerson !== null ? String(pricing.perPerson.min) : "");
  }
  const setPeople = (n: number) => fee !== null && setPeopleText(String(clamp(n, fee.min, fee.max)));

  return (
    <div className="hl-js-only rounded-panel bg-white p-6 shadow-card md:p-9">
      {initialSlug === null ? (
        <div className="mb-6">
          <label htmlFor={`${prefix}-piece`} className="block font-ui text-label font-medium text-ink">
            {catalogWords.quote.choosePiece}
          </label>
          <select
            id={`${prefix}-piece`}
            value={slug ?? ""}
            onChange={(event) => pick(event.target.value)}
            className="mt-2 block h-13 w-full rounded-field border border-ink-2 bg-white px-3.5 font-text text-control text-ink"
          >
            <option value="">{itemWords.chooseLabel}</option>
            {items.map((candidate) => (
              <option key={candidate.slug} value={candidate.slug}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {item !== null && selection !== null ? (
        <>
          <div className="space-y-6">
            {groups.map((group) => (
              <fieldset key={group.id} role="radiogroup">
                <legend className="block font-ui text-label font-medium text-ink">{group.name}</legend>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {group.choices.map((choice) => {
                    const on = options[group.id] === choice.id;
                    return (
                      <label key={choice.id} className="relative">
                        <input
                          type="radio"
                          name={`${prefix}-${group.id}`}
                          value={choice.id}
                          checked={on}
                          onChange={() => setChosen((previous) => ({ ...previous, [group.id]: choice.id }))}
                          className="peer sr-only"
                        />
                        <span
                          className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border px-4.5 font-ui text-chip font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-rust ${
                            on ? "border-ink bg-ink text-silver" : "border-ink-2 text-ink"
                          }`}
                        >
                          {on ? <span aria-hidden="true" className="size-2 rounded-pill bg-rust" /> : null}
                          {choice.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            {fee !== null && people !== undefined ? (
              <div>
                <label htmlFor={`${prefix}-people`} className="block font-ui text-label font-medium text-ink">
                  {fee.label}
                </label>
                <div className="mt-3 flex items-center gap-2.5">
                  <button
                    type="button"
                    aria-label={catalogWords.quote.decrease}
                    onClick={() => setPeople(people - 1)}
                    disabled={people <= fee.min}
                    className="grid size-11 place-items-center rounded-pill border border-ink-2 font-ui text-item text-ink disabled:text-ink-2 disabled:opacity-60"
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <input
                    id={`${prefix}-people`}
                    type="number"
                    inputMode="numeric"
                    min={fee.min}
                    max={fee.max}
                    step={1}
                    value={peopleText}
                    onChange={(event) => setPeopleText(event.target.value)}
                    onBlur={() => setPeopleText(String(people))}
                    aria-describedby={`${prefix}-people-hint`}
                    className="h-13 w-24 rounded-field border border-ink-2 bg-white px-3.5 text-center font-text text-control text-ink"
                  />
                  <button
                    type="button"
                    aria-label={catalogWords.quote.increase}
                    onClick={() => setPeople(people + 1)}
                    disabled={people >= fee.max}
                    className="grid size-11 place-items-center rounded-pill border border-ink-2 font-ui text-item text-ink disabled:text-ink-2 disabled:opacity-60"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
                <p id={`${prefix}-people-hint`} className="mt-2 text-small text-ink-2">
                  {catalogWords.quote.peopleHint(fee.min, fee.max)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-8 border-t border-hairline pt-6">
            <p className="font-ui text-label font-medium text-ink-2">{catalogWords.quote.estimateLabel}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p aria-live="polite" aria-atomic="true" className="font-ui text-h3 font-bold">
                {range ?? catalogWords.onRequest}
              </p>
            </div>
            <p className="mt-3 max-w-narrow text-small text-ink-2">{pricing.note}</p>

            <div className="mt-6">
              {quote === null ? (
                <TextLink href="/contact">{catalogWords.askRoute(itemWord.singular)}</TextLink>
              ) : open ? null : (
                // Once the form is open the button gives way to it; "Change my selection" brings it back.
                <button
                  ref={requestRef}
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    if (!open) track("quote_start", { item_id: item.slug });
                    setOpen(true);
                  }}
                  className="inline-flex min-h-13.5 w-full items-center justify-center rounded-btn bg-ink px-6 font-ui text-btn font-semibold text-silver md:w-auto md:justify-start md:pl-5.5"
                >
                  {catalogWords.quote.requestQuote}
                </button>
              )}
            </div>
          </div>

          {quote !== null && open ? (
            <div className="mt-8 border-t border-hairline pt-6">
              <Heading ref={headingRef} tabIndex={-1} className="font-ui text-card-title font-bold">
                {catalogWords.quote.formHeading}
              </Heading>
              <div className="mt-5 rounded-card bg-tint p-5">
                <p className="font-ui text-label font-medium text-ink-2">{catalogWords.quote.yourSelection}</p>
                <dl className="mt-3 space-y-1.5 text-list">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium">{catalogWords.quote.summaryPiece}:</dt>
                    <dd>{item.name}</dd>
                  </div>
                  {groups.map((group) => (
                    <div key={group.id} className="flex flex-wrap gap-x-2">
                      <dt className="font-medium">{group.name}:</dt>
                      <dd>{group.choices.find((choice) => choice.id === options[group.id])?.label}</dd>
                    </div>
                  ))}
                  {fee !== null && people !== undefined ? (
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium">{fee.label}:</dt>
                      <dd>{people}</dd>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium">{catalogWords.quote.estimateLabel}:</dt>
                    <dd>{range ?? catalogWords.onRequest}</dd>
                  </div>
                </dl>
                {sent ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      returnFocus.current = true;
                      setOpen(false);
                    }}
                    className="mt-3 inline-flex min-h-11 items-center font-ui font-medium text-green underline underline-offset-quarter-em"
                  >
                    {catalogWords.quote.changeSelection}
                  </button>
                )}
              </div>
              <div className="mt-6">
                <FormView id={quote.id} form={quote.form} noScriptEmail={providers.email} selection={selection} onSuccess={() => setSent(true)} panelClass="" />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
