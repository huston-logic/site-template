// Where the root layout puts the ad and analytics tags. This file renders nothing and imports nothing, so a build with
// no tags has no tag code and no extra chunk. When `trackingForBuild` says a build has tags, next.config.ts points this
// import at ./tags-slot-on.tsx instead (a server layout cannot code-split a client component on its own).
export function TagsSlot(): null {
  return null;
}
