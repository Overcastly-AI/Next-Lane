// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './MarkdownRenderer';

describe('renderMarkdown task lists (QA #17)', () => {
  it('renders - [ ] / - [x] as disabled checkboxes', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const boxes = doc.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].hasAttribute('checked')).toBe(false);
    expect(boxes[1].hasAttribute('checked')).toBe(true);
    boxes.forEach((b) => expect(b.hasAttribute('disabled')).toBe(true));
  });

  it('still strips non-checkbox inputs and event handlers', () => {
    const html = renderMarkdown('<input type="text" value="x" onfocus="alert(1)"> hi\n\n<input type="checkbox" onclick="alert(1)" name="n">');
    expect(html).not.toMatch(/type="text"/);
    expect(html).not.toMatch(/onclick|onfocus|name=/);
  });
});
