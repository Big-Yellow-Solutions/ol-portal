// Downscales an image file to a small base64 JPEG data URL, client-side,
// so it can be embedded directly in a profile PATCH body (no separate
// upload step) — matches the original readPhoto() helper duplicated
// across bench.js and welcome.js.
export function readPhoto(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read image"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/* Cover images for Resource Library cards. Where readPhoto only shrinks,
   this crops: cards render a cover at a fixed 3:2, so cropping to that ratio
   here means the editor's preview is exactly what the card will show, and the
   stored bytes are only the pixels that survive the crop.

   The data URL rides on the record itself, so quality steps down until it fits
   under the API's ceiling (MAX_THUMBNAIL_CHARS in backend/src/resources.mjs)
   rather than letting a busy photograph fail the save. */
export const COVER_RATIO = 3 / 2;
const COVER_WIDTH = 720;
const COVER_MAX_CHARS = 110_000;
const COVER_QUALITIES = [0.85, 0.72, 0.6, 0.5, 0.4];

export function readCover(file: File, width = COVER_WIDTH): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read image"));
      img.onload = () => {
        const height = Math.round(width / COVER_RATIO);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));

        // Centre-crop the source to 3:2 first, so nothing is stretched.
        const wide = img.width / img.height > COVER_RATIO;
        const sw = wide ? img.height * COVER_RATIO : img.width;
        const sh = wide ? img.height : img.width / COVER_RATIO;
        ctx.drawImage(
          img,
          (img.width - sw) / 2,
          (img.height - sh) / 2,
          sw,
          sh,
          0,
          0,
          width,
          height
        );

        for (const q of COVER_QUALITIES) {
          const url = canvas.toDataURL("image/jpeg", q);
          if (url.length <= COVER_MAX_CHARS) return resolve(url);
        }
        reject(new Error("That image is too detailed to store — try a simpler one."));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
