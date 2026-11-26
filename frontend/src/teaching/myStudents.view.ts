// Pure display rules of «طلابي» (CH-0370). The rate itself is the server's.

/** The colour of an attendance rate: green from 80 %, gold from 60 %, else red; grey before any record. */
export function rateColor(rate: number | null): string {
  if (rate === null) return 'default'
  if (rate >= 80) return 'green'
  if (rate >= 60) return 'gold'
  return 'red'
}
