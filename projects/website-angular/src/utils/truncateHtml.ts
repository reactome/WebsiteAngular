/**
 * Truncates HTML content to a maximum number of words while preserving valid HTML structure
 * @param html The HTML string to truncate
 * @param maxWords Maximum number of words to include (default: 150)
 * @returns Truncated HTML with properly closed tags, ending in "..." only when
 *   words were left out
 */
export default function truncateHtml(html: string, maxWords: number = 150): string {
  if (!html) return '';

  const tagStack: string[] = [];
  let wordCount = 0;
  let result = '';
  let inTag = false;
  let currentWord = '';
  let currentTag = '';
  // Whether a word was left out: only then does the excerpt end in "..."
  let cut = false;

  // Self-closing tags that don't need to be tracked
  const selfClosingTags = new Set([
    'img',
    'br',
    'hr',
    'input',
    'meta',
    'link',
    'area',
    'base',
    'col',
    'embed',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  for (let i = 0; i < html.length; i++) {
    const char = html.charAt(i);

    if (char === '<') {
      // Save any pending word before processing tag
      if (currentWord.trim()) {
        wordCount++;
        if (wordCount > maxWords) {
          cut = true;
          break;
        }
        result += currentWord;
        currentWord = '';
      }

      inTag = true;
      currentTag = '';
      result += char;
    } else if (char === '>') {
      inTag = false;
      result += char;

      // Parse the tag. A tag's name ends at a space, a slash or the bracket; a
      // markdown link written in angle brackets (<https://...>) is not a tag,
      // and closing it as one would print </https> at the reader.
      const tagMatch = currentTag.match(/^\/?\s*([A-Za-z][\w-]*)(?=[\s/]|$)/);
      if (tagMatch?.[1]) {
        const tagName = tagMatch[1].toLowerCase();

        // Check if it's a closing tag
        if (currentTag.startsWith('/')) {
          // Pop from stack if it matches
          if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tagName) {
            tagStack.pop();
          }
        } else if (!selfClosingTags.has(tagName) && !currentTag.endsWith('/')) {
          // Opening tag - add to stack
          tagStack.push(tagName);
        }
      }

      currentTag = '';
    } else if (inTag) {
      currentTag += char;
      result += char;
    } else {
      // We're in text content
      if (/\s/.test(char)) {
        // Whitespace - end of word
        if (currentWord.trim()) {
          wordCount++;
          if (wordCount > maxWords) {
            cut = true;
            break;
          }
          result += currentWord;
          currentWord = '';
        }
        result += char;
      } else {
        currentWord += char;
      }
    }
  }

  // The last word, if the text ended on one: kept within the limit, and left
  // out (a cut) past it
  if (!cut && currentWord.trim()) {
    if (wordCount < maxWords) result += currentWord;
    else cut = true;
  }

  if (cut) result += '...';

  // Close any unclosed tags in reverse order
  while (tagStack.length > 0) {
    const tagName = tagStack.pop();
    result += `</${tagName}>`;
  }

  return result;
}
