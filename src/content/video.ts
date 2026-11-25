/** The words around a video facade (src/blocks/library/video). The play control's name says where the video opens. */
export const videoCopy = {
  /** "Play video: <title> (opens YouTube)" */
  playLabel: (title: string, providerName: string) => `Play video: ${title} (opens ${providerName})`,
  /** The name of a video grid that has no heading. */
  gridLabel: "Videos",
  providerNames: { youtube: "YouTube", vimeo: "Vimeo" },
} as const;
