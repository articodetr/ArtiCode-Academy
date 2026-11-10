// The grade scheme the seed creates once, when the academy has none (owner
// decision D-R46). An administrator edits it like any other scheme
// (API-124); the seed never touches it again.
import type { LocalizedText } from '../authorization/localized-text.js';

export interface DefaultBand {
  minPercent: number;
  label: LocalizedText;
  letter: string;
  isPass: boolean;
}

export const DEFAULT_GRADE_SCHEME_NAME: LocalizedText = { ar: 'السلّم الافتراضي', en: 'Default scale' };

/** Ascending by minimum: راسب below 60, then مقبول, جيد, جيد جداً, ممتاز. */
export const DEFAULT_GRADE_SCHEME_BANDS: readonly DefaultBand[] = [
  { minPercent: 0, label: { ar: 'راسب', en: 'Fail' }, letter: 'F', isPass: false },
  { minPercent: 60, label: { ar: 'مقبول', en: 'Pass' }, letter: 'D', isPass: true },
  { minPercent: 70, label: { ar: 'جيد', en: 'Good' }, letter: 'C', isPass: true },
  { minPercent: 80, label: { ar: 'جيد جداً', en: 'Very good' }, letter: 'B', isPass: true },
  { minPercent: 90, label: { ar: 'ممتاز', en: 'Excellent' }, letter: 'A', isPass: true },
];
