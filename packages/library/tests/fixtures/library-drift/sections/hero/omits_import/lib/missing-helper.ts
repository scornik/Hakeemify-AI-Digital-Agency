/** FIXTURE — real on disk, absent from the manifest's `files[]`. That is the whole point. */
export function helper(text: string): string {
  return text.toUpperCase();
}
