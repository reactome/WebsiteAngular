/**
 * Parse frontmatter from MDX content
 */
export default function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = match[1];
  const body = match[2];

  // Simple YAML parsing for frontmatter
  const frontmatter: Record<string, unknown> = {};
  const lines = frontmatterStr.split('\n');

  let currentKey: string | null = null;
  let isMultilineValue = false;
  let multilineType: 'literal' | 'folded' | null = null;
  let multilineValue: string[] = [];
  let baseIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if we're in a multiline value
    if (isMultilineValue && currentKey) {
      // Empty line or line with content
      if (line.trim() === '') {
        multilineValue.push('');
      } else {
        const indent = line.length - line.trimStart().length;
        
        // If indentation is less than or equal to base indent, multiline value has ended
        if (indent <= baseIndent && line.trim().match(/^[a-zA-Z_-]+:/)) {
          // Finish the multiline value
          if (multilineType === 'folded') {
            // Folded style (>) - join lines with spaces, preserve paragraph breaks
            const paragraphs = multilineValue.join('\n').split('\n\n');
            frontmatter[currentKey] = paragraphs.map(p => p.replace(/\n/g, ' ').trim()).join('\n\n');
          } else {
            // Literal style (|) - preserve line breaks
            frontmatter[currentKey] = multilineValue.join('\n');
          }
          
          isMultilineValue = false;
          multilineType = null;
          multilineValue = [];
          currentKey = null;
          
          // Process this line as a new key
          i--;
          continue;
        } else {
          // Add line to multiline value (remove base indentation)
          const contentStart = Math.min(indent, baseIndent + 2);
          multilineValue.push(line.substring(contentStart));
        }
      }
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value: string | string[] = line.substring(colonIndex + 1).trim();

      // Check for multiline indicators (|, >, with optional chomping: -, +)
      const multilineMatch = value.match(/^([|>])[-+]?$/);
      if (multilineMatch) {
        currentKey = key;
        isMultilineValue = true;
        multilineType = multilineMatch[1] === '|' ? 'literal' : 'folded';
        multilineValue = [];
        baseIndent = line.length - line.trimStart().length;
        continue;
      }

      // Remove quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Handle empty values or arrays
      if (value === '' || key === 'tags') {
        currentKey = key;
        if (value !== '') {
          frontmatter[key] = value;
        }
        continue;
      }

      frontmatter[key] = value;
      currentKey = key;
    } else if (line.trim().startsWith('- ')) {
      // Handle array item
      if (currentKey) {
        if (!Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = [];
        }
        const itemValue = line.trim().substring(2).trim();
        // Remove quotes if present
        const cleanValue = (itemValue.startsWith("'") && itemValue.endsWith("'")) ||
                          (itemValue.startsWith('"') && itemValue.endsWith('"'))
          ? itemValue.slice(1, -1)
          : itemValue;
        (frontmatter[currentKey] as string[]).push(cleanValue);
      }
    }
  }

  // Handle case where multiline value extends to end of frontmatter
  if (isMultilineValue && currentKey) {
    if (multilineType === 'folded') {
      const paragraphs = multilineValue.join('\n').split('\n\n');
      frontmatter[currentKey] = paragraphs.map(p => p.replace(/\n/g, ' ').trim()).join('\n\n');
    } else {
      frontmatter[currentKey] = multilineValue.join('\n');
    }
  }

  return { frontmatter, body };
}
