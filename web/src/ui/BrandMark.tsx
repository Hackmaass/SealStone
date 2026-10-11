/**
 * The Sealstone symbol (src/assets/sealstone-mark.png, supplied by the team). It is used as a mask filled with the surrounding text
 * colour, so one white-on-transparent file reads correctly on light and dark surfaces (see brand.css). Always shown beside the word "Sealstone".
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <span className="brand-mark" role="img" aria-label="Sealstone symbol" style={{ width: Math.round(size * 0.9), height: size }} />;
}
