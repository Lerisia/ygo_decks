/** A Spine texture atlas (the text format: pages, each followed by its regions). Both the 4.x fields (bounds,
 *  offsets, pma) and the older ones (xy, size, orig, offset) occur among the cut-ins; a page without pma is plain
 *  alpha. */

export type AtlasPage = { name: string; width: number; height: number; pma: boolean };

export type AtlasRegion = {
  page: AtlasPage;
  /** Page coordinates (0..1) of the packed region, as packed: rotated regions keep their rotated corners. */
  u: number; v: number; u2: number; v2: number;
  /** In page pixels: the packed size (unrotated), the whitespace stripped from the left / bottom, the original size. */
  width: number; height: number; offsetX: number; offsetY: number; originalWidth: number; originalHeight: number;
  degrees: number;
};

export function readAtlas(text: string): { pages: AtlasPage[]; regions: Map<string, AtlasRegion> } {
  const pages: AtlasPage[] = [];
  const regions = new Map<string, AtlasRegion>();
  const lines = text.split(/\r?\n/);
  let page: AtlasPage | null = null;
  let i = 0;
  const fields = (): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    while (i < lines.length && lines[i].includes(":")) {
      const [k, v] = lines[i].split(":");
      out.set(k.trim(), v.split(",").map((s) => s.trim()));
      i++;
    }
    return out;
  };
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      page = null;
      i++;
      continue;
    }
    i++;
    if (!page) {
      const f = fields();
      const size = f.get("size") ?? ["0", "0"];
      page = { name: line, width: Number(size[0]), height: Number(size[1]), pma: f.get("pma")?.[0] === "true" };
      pages.push(page);
      continue;
    }
    const f = fields();
    const bounds = (f.get("bounds") ?? [...(f.get("xy") ?? ["0", "0"]), ...(f.get("size") ?? ["0", "0"])]).map(Number);
    const old = f.get("orig") || f.get("offset")
      ? [...(f.get("offset") ?? ["0", "0"]), ...(f.get("orig") ?? f.get("size") ?? ["0", "0"])] : undefined;
    const offsets = (f.get("offsets") ?? old)?.map(Number);
    const rotate = f.get("rotate")?.[0];
    const degrees = rotate === "true" ? 90 : rotate === "false" || rotate === undefined ? 0 : Number(rotate);
    const [x, y, width, height] = bounds;
    const turned = degrees === 90 || degrees === 270;
    regions.set(line, {
      page, width, height, degrees,
      u: x / page.width, v: y / page.height,
      u2: (x + (turned ? height : width)) / page.width, v2: (y + (turned ? width : height)) / page.height,
      offsetX: offsets ? offsets[0] : 0, offsetY: offsets ? offsets[1] : 0,
      originalWidth: offsets ? offsets[2] : width, originalHeight: offsets ? offsets[3] : height,
    });
  }
  return { pages, regions };
}
