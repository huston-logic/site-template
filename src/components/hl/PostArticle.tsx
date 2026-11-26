import { Container } from "@/components/hl/Container";
import { HlLink } from "@/components/hl/HlLink";
import { Photo } from "@/components/hl/Photo";
import { PostBody } from "@/components/hl/PostBody";
import { DraftTag } from "@/components/hl/PostCard";
import { JsonLd } from "@/components/ui/JsonLd";
import { Text } from "@/components/ui/Text";
import type { LoadedItem } from "@/collections/schema";
import { blog } from "@/content/blog";
import { BLOG_PATH, formatDate, postData, postJsonLd, postPath } from "@/lib/blog";
import { absoluteUrl } from "@/lib/metadata";

/** One post page: the title, the date, an optional photo and the body in a reading-width column, then a link back to the blog. */
export function PostArticle({ post }: { post: LoadedItem }) {
  const data = postData(post);
  const jsonLd = post.status === "live" ? postJsonLd({ url: absoluteUrl(postPath(post.slug)), title: data.title, date: data.date, updated: data.updated }) : null;
  return (
    <article className="pb-16 pt-18 md:pb-24">
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      <Container>
        <div className="max-w-measure">
          {post.status === "draft" ? (
            <p className="mb-5">
              <DraftTag />
            </p>
          ) : null}
          <h1 className="font-ui text-page-title font-bold">
            <Text>{data.title}</Text>
          </h1>
          <p className="mt-5 font-ui text-small font-medium text-ink-2">
            <time dateTime={data.date}>{formatDate(data.date)}</time>
            {data.updated ? (
              <>
                {" · "}
                {blog.updatedWord} <time dateTime={data.updated}>{formatDate(data.updated)}</time>
              </>
            ) : null}
          </p>
          {data.image ? <Photo image={data.image} shape="3:2" sizes="(min-width: 1024px) 700px, 100vw" className="mt-10" /> : null}
          <div className="mt-10">
            <PostBody parts={data.body} />
          </div>
          <div className="mt-14 border-t border-hairline pt-6">
            <HlLink href={BLOG_PATH} className="inline-flex min-h-11 items-center font-ui font-medium text-green">
              <span className="hl-u">{blog.backToBlog}</span>
            </HlLink>
          </div>
        </div>
      </Container>
    </article>
  );
}
