import { Container } from "@/components/hl/Container";
import { Text } from "@/components/ui/Text";
import { videoCopy } from "@/content/video";
import { parseVideoUrl } from "@/blocks/embeds";
import type { BlockProps } from "@/blocks/types";
import type { ContentOf } from "@/blocks/schema";
import { VideoFacade } from "../video/VideoFacade";
import type { videoGridDefinition } from "./definition";

/** Two to six videos, each behind its own play button. */
export function VideoGridBlock({ content, variant, anchor, headingId }: BlockProps<ContentOf<typeof videoGridDefinition.fields>>) {
  const three = variant === "three-column";
  return (
    <section id={anchor} aria-labelledby={content.heading ? headingId : undefined} aria-label={content.heading ? undefined : videoCopy.gridLabel} className="scroll-mt-24">
      <Container>
        {content.heading ? (
          <h2 id={headingId} className="font-ui text-h2 font-bold">
            <Text>{content.heading}</Text>
          </h2>
        ) : null}
        <ul className={`${content.heading ? "mt-12 " : ""}grid gap-x-12 gap-y-14 md:grid-cols-2 ${three ? "lg:grid-cols-3" : ""}`}>
          {content.videos.map((item, index) => {
            const video = parseVideoUrl(item.url);
            if (!video) throw new Error(`The video address "${item.url}" is not on the allowlist.`);
            return (
              <li key={index}>
                <VideoFacade video={video} title={item.title} caption={item.caption} poster={item.poster} />
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
