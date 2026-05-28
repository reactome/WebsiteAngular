// Wraps <pre> code blocks longer than COLLAPSE_THRESHOLD lines in a
// <details class="code-block"><summary>…</summary>…</details> so long code
// samples on documentation pages start collapsed and can be expanded on demand
// instead of dominating the reading flow.
const COLLAPSE_THRESHOLD = 8;

export default function wrapCodeBlocks(html: string): string {
  return html.replace(/<pre>([\s\S]*?)<\/pre>/g, (match, body) => {
    const text = body.replace(/<[^>]+>/g, '');
    const lines = text.split('\n').filter((l: string) => l.trim().length > 0).length;
    if (lines < COLLAPSE_THRESHOLD) return match;
    return `<details class="code-block"><summary>Show code <span class="code-block-meta">(${lines} lines)</span></summary>${match}</details>`;
  });
}
