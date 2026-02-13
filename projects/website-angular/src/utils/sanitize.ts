import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export default function sanitize(html: string, sanitizer: DomSanitizer): SafeHtml {
    return sanitizer.bypassSecurityTrustHtml(html);
}