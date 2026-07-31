// @vitest-environment jsdom
/**
 * Tests for the `nl-image:` page-image pipeline.
 *
 * Two halves, and both matter:
 *
 *  1. The SANITIZER must let `nl-image:<id>` through while every other novel
 *     scheme stays blocked. This is the risky half — permitting a new URI
 *     scheme in DOMPurify is exactly the kind of change that quietly widens an
 *     allowlist, so the negative cases here are the point of the file.
 *  2. The RESOLVER must replace those references with authorized `blob:` URLs,
 *     and must leave a failed one visibly broken rather than silently blank.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageImageMarkdown, parsePageImageSrc } from '@next-lane/shared';

const fetchPageImageBlobUrl = vi.fn<(id: string) => Promise<string>>();
vi.mock('@/api/pageImages', () => ({
  fetchPageImageBlobUrl: (id: string) => fetchPageImageBlobUrl(id),
}));

const { renderMarkdown } = await import('@/components/ui/MarkdownRenderer');
const { resolvePageImagesIn, __clearPageImageCache } = await import('./pageImages');

function imgSrc(html: string): string | null {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.querySelector('img')?.getAttribute('src') ?? null;
}

describe('page image markdown helpers', () => {
  it('round-trips an id through markdown and back', () => {
    const md = pageImageMarkdown({ id: 'abc123', filename: 'screenshot.png' });
    expect(md).toBe('![screenshot.png](nl-image:abc123)');
    expect(parsePageImageSrc('nl-image:abc123')).toBe('abc123');
  });

  it('strips brackets from the filename so the alt text cannot break the link', () => {
    const md = pageImageMarkdown({ id: 'x1', filename: 'a[b](c).png' });
    // The `[` and `]` are what would terminate the alt-text span early and
    // leave `](nl-image:x1)` rendering as literal text.
    expect(md).toBe('![ab(c).png](nl-image:x1)');
    expect(imgSrc(renderMarkdown(md))).toBe('nl-image:x1');
  });

  it('rejects a non-image src and an empty id', () => {
    expect(parsePageImageSrc('https://example.com/a.png')).toBeNull();
    expect(parsePageImageSrc('nl-image:')).toBeNull();
    expect(parsePageImageSrc('nl-image:   ')).toBeNull();
  });
});

describe('renderMarkdown — nl-image scheme', () => {
  it('preserves an nl-image src', () => {
    expect(imgSrc(renderMarkdown('![shot](nl-image:ckabc123XYZ_-)'))).toBe(
      'nl-image:ckabc123XYZ_-',
    );
  });

  it('still allows http(s) and data:image srcs', () => {
    expect(imgSrc(renderMarkdown('![a](https://example.com/a.png)'))).toBe(
      'https://example.com/a.png',
    );
    expect(imgSrc(renderMarkdown('![a](data:image/png;base64,AAA)'))).toBe(
      'data:image/png;base64,AAA',
    );
  });

  it('strips an nl-image src carrying anything but a bare id', () => {
    // A traversal-shaped id, a scheme smuggled after the id, and a whitespace
    // split — none of these reach the resolver, so none can be used to make it
    // fetch something other than an image record.
    for (const bad of [
      'nl-image:../../etc/passwd',
      'nl-image:abc/../../x',
      'nl-image:abc javascript:alert(1)',
      'nl-image:abc?x=1',
      'nl-image:',
    ]) {
      expect(imgSrc(renderMarkdown(`![a](${bad})`))).toBeNull();
    }
  });

  it('still blocks javascript: and other schemes on images', () => {
    expect(imgSrc(renderMarkdown('![a](javascript:alert(1))'))).toBeNull();
    expect(imgSrc(renderMarkdown('![a](data:text/html,<script>x</script>)'))).toBeNull();
  });

  it('never lets nl-image become a link target', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('[click](nl-image:abc123)');
    expect(el.querySelector('a')?.hasAttribute('href')).toBe(false);
  });
});

describe('resolvePageImagesIn', () => {
  beforeEach(() => {
    fetchPageImageBlobUrl.mockReset();
    __clearPageImageCache();
    // jsdom has no object-URL implementation.
    globalThis.URL.createObjectURL ??= () => 'blob:stub';
    globalThis.URL.revokeObjectURL ??= () => {};
  });

  afterEach(() => {
    __clearPageImageCache();
  });

  it('swaps each nl-image reference for its blob URL', async () => {
    fetchPageImageBlobUrl.mockImplementation(async (id) => `blob:resolved-${id}`);
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(
      '![one](nl-image:aaa)\n\n![two](nl-image:bbb)',
    );

    await resolvePageImagesIn(root);

    const srcs = Array.from(root.querySelectorAll('img')).map((i) => i.src);
    expect(srcs).toEqual(['blob:resolved-aaa', 'blob:resolved-bbb']);
    // The id stays addressable after the swap, for tests and for a later
    // re-resolve — the src no longer carries it.
    expect(root.querySelector('img')?.getAttribute('data-nl-image')).toBe('aaa');
  });

  it('fetches each distinct image exactly once across repeated passes', async () => {
    fetchPageImageBlobUrl.mockImplementation(async (id) => `blob:${id}`);
    const html = renderMarkdown('![a](nl-image:same)\n\n![b](nl-image:same)');

    const first = document.createElement('div');
    first.innerHTML = html;
    await resolvePageImagesIn(first);

    // A re-render replaces the nodes, so the second container starts with
    // unresolved refs again — the memo is what stops it refetching.
    const second = document.createElement('div');
    second.innerHTML = html;
    await resolvePageImagesIn(second);

    expect(fetchPageImageBlobUrl).toHaveBeenCalledTimes(1);
  });

  it('marks a failed image instead of blanking it, and does not cache the failure', async () => {
    fetchPageImageBlobUrl.mockRejectedValueOnce(new Error('403'));
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('![gone](nl-image:zzz)');

    await resolvePageImagesIn(root);

    const img = root.querySelector('img')!;
    expect(img.hasAttribute('data-nl-image-error')).toBe(true);
    expect(img.getAttribute('alt')).toBe('gone');

    // A retry must actually retry: caching the rejection would leave the image
    // permanently broken until a full page reload.
    fetchPageImageBlobUrl.mockResolvedValueOnce('blob:recovered');
    await resolvePageImagesIn(root);
    expect(root.querySelector('img')!.src).toBe('blob:recovered');
  });

  it('clears the unloadable src while fetching, so no broken-image icon paints', async () => {
    let release!: (url: string) => void;
    fetchPageImageBlobUrl.mockImplementation(
      () => new Promise<string>((res) => { release = res; }),
    );
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('![slow](nl-image:slow1)');

    const done = resolvePageImagesIn(root);
    const img = root.querySelector('img')!;
    // The browser has no handler for `nl-image:`, so leaving it as the src for
    // the duration of the fetch is a broken-image icon on every page load.
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.hasAttribute('data-nl-image-loading')).toBe(true);

    release('blob:arrived');
    await done;
    expect(img.src).toBe('blob:arrived');
    expect(img.hasAttribute('data-nl-image-loading')).toBe(false);
  });

  it('ignores images with ordinary srcs', async () => {
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('![a](https://example.com/a.png)');
    await resolvePageImagesIn(root);
    expect(fetchPageImageBlobUrl).not.toHaveBeenCalled();
  });
});
