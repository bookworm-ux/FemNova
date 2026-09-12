import { privacy } from './privacy.js';
import { classifyLabs, validLabInput } from './analysis.js';

// Trusted preparation: select only values/ranges, never IDs, dates or comments.
export async function privateLabFlags(labs, ranges, gateway = privacy) {
  if (!labs.length) return { flags: [], status: 'empty' };
  const pairs = [['ft3', 'freeT3', 'free_t3'], ['ft4', 'freeT4', 'free_t4'], ['tsh', 'tsh', 'tsh'], ['hb', 'hb', 'hb']];
  const payload = {
    panels: labs.map(lab => Object.fromEntries(pairs.map(([code, , key]) => [code, lab[key] ?? null]))),
    ranges: Object.fromEntries(pairs.map(([code, key]) => [code, { low: ranges[key].low, high: ranges[key].high, margin: 0 }])),
  };
  try {
    const input = await gateway.json(payload, data => validLabInput(data) && JSON.stringify(data) === JSON.stringify(payload));
    const flags = classifyLabs(input).map(panel => Object.fromEntries(pairs.map(([code, key]) => [key, panel[code]])));
    return { flags, status: 'completed' };
  } catch {
    // Records can still be displayed. No range assessment is supplied on failure.
    return { flags: labs.map(() => null), status: 'unavailable' };
  }
}
