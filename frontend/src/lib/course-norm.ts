/** Match backend `course_norm` / catalog: uppercase, single spaces. No pdf.js side effects. */
export function toCourseNorm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toUpperCase()
}
