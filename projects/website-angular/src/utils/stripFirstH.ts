export default function stripFirstH(html: string): string {
    // Remove the first H1 tag since it's already displayed in the header from frontmatter
    return html.replace(/^<h1[^>]*>.*?<\/h1>\s*/i, '').replace(/^<h2[^>]*>.*?<\/h2>\s*/i, '');
  }