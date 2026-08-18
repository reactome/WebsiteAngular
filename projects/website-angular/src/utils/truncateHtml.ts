/**
 * Truncates HTML content to a maximum number of words while preserving valid HTML structure
 * @param html The HTML string to truncate
 * @param maxWords Maximum number of words to include (default: 150)
 * @returns Truncated HTML with properly closed tags
 */
export default function truncateHtml(html: string, maxWords: number = 150): string {
  if (!html) return '';

  const tagStack: string[] = [];
  let wordCount = 0;
  let result = '';
  let inTag = false;
  let currentWord = '';
  let currentTag = '';

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
    const char = html[i];

    if (char === '<') {
      // Save any pending word before processing tag
      if (currentWord.trim()) {
        wordCount++;
        if (wordCount > maxWords) break;
        result += currentWord;
        currentWord = '';
      }

      inTag = true;
      currentTag = '';
      result += char;
    } else if (char === '>') {
      inTag = false;
      result += char;

      // Parse the tag
      const tagMatch = currentTag.match(/^\/?\s*(\w+)/);
      if (tagMatch) {
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
          if (wordCount > maxWords) break;
          result += currentWord;
          currentWord = '';
        }
        result += char;
      } else {
        currentWord += char;
      }
    }
  }

  // Add any remaining word if we haven't exceeded limit
  if (wordCount < maxWords && currentWord.trim()) {
    result += currentWord;
  }

  result += '...';

  // Close any unclosed tags in reverse order
  while (tagStack.length > 0) {
    const tagName = tagStack.pop();
    result += `</${tagName}>`;
  }

  // Add ellipsis if we truncated
  if (wordCount >= maxWords) {
    result;
  }

  return result;
}
