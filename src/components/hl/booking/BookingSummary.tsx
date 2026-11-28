import { Text } from "@/components/ui/Text";
import { bookingWords as words } from "@/content/booking";

export type SummaryData = {
  serviceName: string;
  /** One line per session, in the business's zone. */
  sessions: { heading: string; label: string }[];
  /** Shown only when the service takes more than one person. */
  people: string | null;
  /** Money lines, already written. Null for a service with no price. */
  money: { total: string; dueNow: string; dueLater: string | null } | null;
  policy: string;
  giftCardLine: string | null;
  itemName: string | null;
};

/** What the visitor is about to confirm, as a plain ledger: the service, each session's local time, the people, then the money, then the owner's policy. */
export function BookingSummary({ data, headingId }: { data: SummaryData; headingId: string }) {
  const { money } = data;
  return (
    <section aria-labelledby={headingId} className="rounded-card bg-tint p-5 md:p-6">
      <h3 id={headingId} className="font-ui text-item font-bold">
        {words.summaryHeading}
      </h3>
      {data.itemName ? <p className="mt-1 text-small text-ink-2">{words.summary.forItem(data.itemName)}</p> : null}
      <dl className="mt-4 divide-y divide-hairline border-y border-hairline text-list">
        <div className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
          <dt className="font-ui font-medium text-ink-2">{words.summary.service}</dt>
          <dd>
            <Text>{data.serviceName}</Text>
          </dd>
        </div>
        {data.sessions.map((session) => (
          <div key={session.heading} className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
            <dt className="font-ui font-medium text-ink-2">{session.heading}</dt>
            <dd>{session.label}</dd>
          </div>
        ))}
        {data.people ? (
          <div className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
            <dt className="font-ui font-medium text-ink-2">{words.summary.people}</dt>
            <dd>{data.people}</dd>
          </div>
        ) : null}
        {money ? (
          <>
            <div className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="font-ui font-medium text-ink-2">{words.summary.total}</dt>
              <dd>{money.total}</dd>
            </div>
            <div className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="font-ui font-bold">{words.summary.dueNow}</dt>
              <dd className="font-ui text-item font-bold">{money.dueNow}</dd>
            </div>
            {money.dueLater ? (
              <div className="grid gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="font-ui font-medium text-ink-2">{words.summary.dueLater}</dt>
                <dd>{money.dueLater}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      <div className="mt-4 space-y-2 text-small text-ink-2">
        <p>
          <Text>{data.policy}</Text>
        </p>
        {data.giftCardLine ? (
          <p>
            <Text>{data.giftCardLine}</Text>
          </p>
        ) : null}
      </div>
    </section>
  );
}
