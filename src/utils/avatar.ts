/**
 * Generates a deterministic avatar SVG from a string (email/uid).
 * Uses the Walker diamond shapes with unique color and opacity per user.
 */

const COLORS = [
  '#2dd4bf', // teal (default)
  '#818cf8', // indigo
  '#f472b6', // pink
  '#fb923c', // orange
  '#a3e635', // lime
  '#38bdf8', // sky
  '#c084fc', // purple
  '#4ade80', // green
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function generateAvatarSvg(seed: string): string {
  const hash = hashCode(seed);

  const color = COLORS[hash % COLORS.length];
  const bg = '#1f2937';

  // 5 diamonds — each gets a deterministic opacity based on hash bits
  const opacities = [
    0.3 + ((hash >> 0)  & 0x7) * 0.1,
    0.3 + ((hash >> 3)  & 0x7) * 0.1,
    0.3 + ((hash >> 6)  & 0x7) * 0.1,
    0.3 + ((hash >> 9)  & 0x7) * 0.1,
    0.3 + ((hash >> 12) & 0x7) * 0.1,
  ].map(o => Math.min(1, o).toFixed(2));

  return `<svg viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="192" height="192" rx="96" fill="${bg}"/>
    <path d="M 44,59 68,83 44,107 20,83 Z"     fill="${color}" opacity="${opacities[0]}"/>
    <path d="M 96,59 120,83 96,107 72,83 Z"     fill="${color}" opacity="${opacities[1]}"/>
    <path d="M 148,59 172,83 148,107 124,83 Z"  fill="${color}" opacity="${opacities[2]}"/>
    <path d="M 70,85 94,109 70,133 46,109 Z"    fill="${color}" opacity="${opacities[3]}"/>
    <path d="M 122,85 146,109 122,133 98,109 Z" fill="${color}" opacity="${opacities[4]}"/>
  </svg>`;
}

export function generateAvatarDataUrl(seed: string): string {
  const svg = generateAvatarSvg(seed);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
