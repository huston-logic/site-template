import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditRoutes, blogRoutes, indexableRoutes, noindexRoutes, pageRoutes } from "./routes.ts";

const slugs = (n: number) => Array.from({ length: n }, (_, i) => `post-${i + 1}`);

describe("blogRoutes", () => {
  it("10 live posts have no page 2; 11 have /blog/page/2 and never /blog/page/1", () => {
    assert.deepEqual(blogRoutes(slugs(10), slugs(10)).indexPages, []);
    assert.deepEqual(blogRoutes(slugs(11), slugs(11)).indexPages, ["/blog/page/2"]);
  });
  it("lists every live post, newest first as given", () => {
    assert.deepEqual(blogRoutes(["b", "a"], ["b", "a"]).posts, ["/blog/b", "/blog/a"]);
  });
  it("a draft post is built but never indexable", () => {
    const r = blogRoutes(["a"], ["wip", "a"]);
    assert.deepEqual(r.posts, ["/blog/a"]);
    assert.deepEqual(r.draftPosts, ["/blog/wip"]);
  });
});

describe("the route lists of this repo", () => {
  it("audit routes are the pages plus at most the newest post and page 2", () => {
    assert.deepEqual(auditRoutes.slice(0, pageRoutes.length), pageRoutes);
    assert.ok(auditRoutes.length <= pageRoutes.length + 2);
  });
  it("the sitemap holds every audited route and no noindex route", () => {
    for (const route of auditRoutes) assert.ok(indexableRoutes.includes(route), route);
    for (const route of noindexRoutes) assert.ok(!indexableRoutes.includes(route), route);
  });
  it("the blog page is a page route", () => {
    assert.ok(pageRoutes.includes("/blog"));
  });
});
