import addAnchorIds from './addAnchorIds';
import addJumpCards from './addJumpCards';
import stripFirstH from './stripFirstH';
import wrapCodeBlocks from './wrapCodeBlocks';

/**
 * The steps every content body goes through after markdown, in order.
 *
 * Keep this chain intact. Each step was added by a specific fix, and the
 * imports alone do nothing: wrapCodeBlocks collapses long code blocks (#98),
 * addJumpCards builds the dev-page cards, and addAnchorIds gives headings the
 * ids that "#" links need (#89). Dropping the calls but keeping the imports is
 * exactly how those regressed once already. It lives here, not in each
 * renderer, so the page, the article and the link check all see the same HTML.
 */
export default function renderContentBody(html: string): string {
  return stripFirstH(addAnchorIds(addJumpCards(wrapCodeBlocks(html))));
}
