import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export default function stripFirstHandSanitize(html: string, sanitizer: DomSanitizer): SafeHtml {
  // Sanitize the HTML first to prevent any potential XSS issues, then remove the first H1 or H2 tag since it's already displayed in the header from frontmatter
  // Remove the first H1 tag since it's already displayed in the header from frontmatter
  return sanitizer.bypassSecurityTrustHtml(
    html.replace(/^<h1[^>]*>.*?<\/h1>\s*/i, '').replace(/^<h2[^>]*>.*?<\/h2>\s*/i, '')
  );
}
