import type { ComponentType } from "react";
import { Glow } from "@/components/hl/Glow";
import { blockComponents } from "./components";
import { registry } from "./definitions";
import { spacingFor } from "./rhythm";
import type { AnyBlockDefinition, BlockInstance } from "./schema";
import type { BlockProps } from "./types";

type AnyProps = BlockProps<Record<string, unknown>>;

const definitions = new Map<string, AnyBlockDefinition>(registry.map((def) => [def.type, def]));

/**
 * Builds a page's blocks. Each block sits in its own wrapper, which owns the spacing (rhythm.ts), the glows and the
 * entrance motion, so a block's component carries none of those. The content was checked at build time (lib/pages.ts).
 */
export function BlockRenderer({ blocks }: { blocks: readonly BlockInstance[] }) {
  return (
    <div className="relative overflow-x-clip">
      {blocks.map((block, index) => {
        const def = definitions.get(block.type);
        const Component = blockComponents[block.type] as ComponentType<AnyProps> | undefined;
        if (!def || !Component) throw new Error(`The block type "${block.type}" has no definition or component.`);
        const previous = index > 0 ? definitions.get(blocks[index - 1]?.type ?? "") : undefined;
        const anchor = block.anchor ?? def.fixedAnchor;
        const headingId = `${anchor ?? `block-${index}`}-title`;
        const animated = index > 0 && def.motion.entrance !== "none";
        return (
          <div key={index} className={`relative ${spacingFor(def, index, previous)}`} data-block={block.type} data-motion={animated ? "enter" : undefined}>
            {def.placement.position === "first" ? <Glow variant="green" className="hl-glow-hero" /> : null}
            {def.placement.position === "last" ? <Glow variant="seam" className="hl-glow-closing" /> : null}
            <Component content={block.content} variant={block.variant ?? def.variants[0]?.name ?? "default"} anchor={anchor} headingId={headingId} primary={index === 0} />
          </div>
        );
      })}
    </div>
  );
}
