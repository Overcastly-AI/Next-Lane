/**
 * Resolution of `nl-image:<id>` markdown image references into displayable
 * `blob:` URLs.
 *
 * Why not just store a URL in the markdown? Because a stored absolute URL bakes
 * the deployment origin into user content — move an install from `localhost` to
 * a domain, or export a page, and every image breaks. And because a plain URL
 * would have to be reachable without an Authorization header, which means an
 * image embedded in a private page would be *less* private than the page.
 *
 * So the body stores an app-internal reference, and the renderer resolves it at
 * display time by fetching the bytes WITH the reader's token and swapping in an
 * object URL. An image is therefore exactly as private as the page holding it:
 * a reader who cannot GET the page cannot GET its images either, enforced by
 * the same authorization check rather than a parallel one that can drift.
 *
 * Object URLs are cached per image id for the lifetime of the tab. Caching is
 * what makes this practical: without it, every re-render of a page with ten
 * screenshots would refetch ten blobs. The cache holds the URL, not the bytes —
 * the blob itself is retained by the browser as long as the URL is unrevoked,
 * so entries are deliberately never revoked while the app is running. A page
 * body full of images is bounded by the 10 MB per-image upload cap, and a full
 * reload clears everything.
 */
import { useEffect } from 'react';
import { PAGE_IMAGE_SCHEME, parsePageImageSrc } from '@next-lane/shared';
import { fetchPageImageBlobUrl } from '@/api/pageImages';

/** id -> in-flight or settled object-URL promise. */
const blobUrlCache = new Map<string, Promise<string>>();

/** Resolve (and memoize) one image id to a `blob:` URL. */
export function resolvePageImage(imageId: string): Promise<string> {
  const hit = blobUrlCache.get(imageId);
  if (hit) return hit;
  const p = fetchPageImageBlobUrl(imageId).catch((err: unknown) => {
    // A failed fetch must NOT be cached: the usual cause is a transient error
    // or a token that was refreshed a moment later, and a poisoned cache entry
    // would leave the image permanently broken until a full reload.
    blobUrlCache.delete(imageId);
    throw err;
  });
  blobUrlCache.set(imageId, p);
  return p;
}

/** Test seam: drop every memoized object URL. */
export function __clearPageImageCache(): void {
  for (const p of blobUrlCache.values()) {
    void p.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  blobUrlCache.clear();
}

/**
 * Swap every `nl-image:` src inside `root` for a `blob:` URL.
 *
 * Exported separately from the hook so it can be driven directly in tests and
 * reused by any surface that renders page markdown outside React's tree.
 * Resolves once every image has settled (successfully or not) so callers can
 * await a fully-painted container.
 */
export async function resolvePageImagesIn(root: HTMLElement): Promise<void> {
  const imgs = Array.from(
    root.querySelectorAll<HTMLImageElement>(
      // Unresolved references, plus any element a PREVIOUS pass claimed and
      // failed on. Without the second selector a retry could never find the
      // image again: the failed pass removed the `nl-image:` src, so the
      // element would be invisible to the query forever.
      `img[src^="${PAGE_IMAGE_SCHEME}"], img[data-nl-image-error]`,
    ),
  );
  await Promise.all(
    imgs.map(async (img) => {
      const id =
        parsePageImageSrc(img.getAttribute('src') ?? '') ??
        img.getAttribute('data-nl-image');
      if (!id) return;
      // Marks the element as claimed so a concurrent pass doesn't refetch, and
      // gives tests/e2e a stable hook for "this image came from a page upload".
      img.setAttribute('data-nl-image', id);
      // Drop the unresolvable src BEFORE awaiting. The browser cannot load an
      // `nl-image:` URL, so leaving it in place paints a broken-image icon for
      // the whole duration of the fetch — the first thing a reader sees on
      // every page with a picture in it. Without a src the element falls back
      // to a skeleton (see `.markdown-body img[data-nl-image-loading]`).
      img.removeAttribute('src');
      img.setAttribute('data-nl-image-loading', '');
      try {
        img.src = await resolvePageImage(id);
        img.removeAttribute('data-nl-image-loading');
        img.removeAttribute('data-nl-image-error');
      } catch {
        img.removeAttribute('data-nl-image-loading');
        // Leave the unresolvable reference in place rather than blanking it:
        // the alt text still renders, and a broken image is a more honest
        // signal than an image that silently vanished.
        img.setAttribute('data-nl-image-error', '');
      }
    }),
  );
}

/**
 * Resolve page-image references inside a rendered-markdown container.
 *
 * Depends on `content` rather than running once: the container's innerHTML is
 * replaced whenever the body changes, which discards the resolved `src`
 * attributes along with the old nodes.
 */
export function usePageImageResolver(
  ref: React.RefObject<HTMLElement | null>,
  content: string,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await resolvePageImagesIn(el);
    })();
    return () => {
      cancelled = true;
    };
  }, [ref, content]);
}
