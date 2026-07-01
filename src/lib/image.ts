/**
 * Reads an image File, resizes it so the longest side is ≤ maxPx, and returns
 * a compressed JPEG/PNG data URL. Runs entirely in the browser (canvas) — the
 * result is a small base64 string stored in the DB, no object storage needed.
 */
export function resizeImage(file: File, maxPx = 300): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, w, h);
        // Prefer JPEG for photos (smaller); keep transparency for PNG.
        const hasAlpha = file.type === 'image/png';
        resolve(canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
