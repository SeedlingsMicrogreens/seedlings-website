const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'DIV', 'SPAN']);
// Removed with their contents; any other unknown tag is unwrapped so its text survives.
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
const SAFE_HREF = /^(https?:|mailto:|tel:|\/|#)/i;
const ALIGNMENT = /^(left|center|right|justify)$/i;
const TEXT_ALIGN_STYLE = /^\s*text-align:\s*(left|center|right|justify)\s*;?\s*$/i;

/**
 * Sanitises Admin rich-text HTML for display: allow-listed tags only, links limited to safe schemes and
 * text alignment the only formatting attribute kept. Browser-only (uses an inert <template>).
 */
export function sanitizeRichTextHtml(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source) return '';
  const template = document.createElement('template');
  template.innerHTML = source;
  // Reverse document order handles children before their parents, so unwrapping never skips a nested node.
  Array.from(template.content.querySelectorAll('*')).reverse().forEach((element) => {
    // SVG/MathML elements keep lowercase tag names, so compare case-insensitively.
    const tag = element.tagName.toUpperCase();
    if (DROPPED_TAGS.has(tag)) { element.remove(); return; }
    if (!ALLOWED_TAGS.has(tag)) { element.replaceWith(...Array.from(element.childNodes)); return; }
    for (const { name, value: attributeValue } of Array.from(element.attributes)) {
      const keep = (name === 'href' && tag === 'A' && SAFE_HREF.test(attributeValue.trim()))
        || (name === 'style' && TEXT_ALIGN_STYLE.test(attributeValue))
        || (name === 'align' && ALIGNMENT.test(attributeValue));
      if (!keep) element.removeAttribute(name);
    }
    if (tag === 'A' && element.hasAttribute('href')) {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
}

/** Plain text of Admin rich-text HTML, e.g. for summaries and meta descriptions. Browser-only. */
export function richTextPlain(value: unknown): string {
  // A space before line breaks and block ends keeps words from separate paragraphs apart.
  const source = typeof value === 'string' ? value.replace(/<(br|\/(p|div|li|h[1-6]|blockquote))\b[^>]*>/gi, ' $&') : '';
  if (!source) return '';
  return (new DOMParser().parseFromString(source, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
}
