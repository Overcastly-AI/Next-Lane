/**
 * Image node for the editor. Page uploads are stored as `nl-image:<id>` (see
 * `lib/pageImages.ts`), which a browser cannot load by itself; this node view
 * resolves them to authorised `blob:` URLs exactly like the read-mode renderer
 * does, so a screenshot you just pasted shows up while you write.
 *
 * Only `http(s):`, `data:image/` and resolved `nl-image:` sources ever reach an
 * `<img src>` — the same allowlist `MarkdownRenderer` enforces after
 * sanitising, so a `javascript:` image can never become live in the editor.
 */
import Image from '@tiptap/extension-image';
import { parsePageImageSrc } from '@next-lane/shared';
import { resolvePageImage } from '@/lib/pageImages';

const SAFE_SRC = /^(https?:\/\/|data:image\/)/i;
const UPLOADING = /^uploading-\d+$/;

export const EditorImage = Image.extend({
  addNodeView() {
    return ({ node: initial }) => {
      let node = initial;
      const img = document.createElement('img');
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.draggable = false;

      const apply = () => {
        const src = String(node.attrs.src ?? '');
        img.alt = String(node.attrs.alt ?? '');
        if (node.attrs.title) img.title = String(node.attrs.title);
        else img.removeAttribute('title');
        const id = parsePageImageSrc(src);
        img.removeAttribute('data-nl-image-error');
        if (id) {
          img.removeAttribute('src');
          img.setAttribute('data-nl-image', id);
          img.setAttribute('data-nl-image-loading', '');
          resolvePageImage(id)
            .then((url) => {
              if (img.getAttribute('data-nl-image') !== id) return;
              img.src = url;
              img.removeAttribute('data-nl-image-loading');
            })
            .catch(() => {
              if (img.getAttribute('data-nl-image') !== id) return;
              img.removeAttribute('data-nl-image-loading');
              img.setAttribute('data-nl-image-error', '');
            });
        } else if (SAFE_SRC.test(src)) {
          img.removeAttribute('data-nl-image');
          img.removeAttribute('data-nl-image-loading');
          img.src = src;
        } else {
          img.removeAttribute('src');
          img.removeAttribute('data-nl-image');
          if (UPLOADING.test(src)) img.setAttribute('data-nl-image-loading', '');
          else img.removeAttribute('data-nl-image-loading');
        }
      };
      apply();

      return {
        dom: img,
        update: (next) => {
          if (next.type !== node.type) return false;
          node = next;
          apply();
          return true;
        },
      };
    };
  },
});
