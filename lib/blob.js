/**
 * Vercel Blob upload helper.
 *
 * On Vercel (BLOB_READ_WRITE_TOKEN set), uploads go to Vercel Blob and
 * return a public URL. In local development without the token, we fall
 * back to the legacy on-disk uploads path so `npm run dev` keeps working
 * without extra setup.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let blobApi = null;
function enabled() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}
function api() {
  if (!blobApi) blobApi = require('@vercel/blob');
  return blobApi;
}

/**
 * @param {{buffer:Buffer, originalname:string, mimetype?:string}} file
 *   A multer file object. We only need buffer + originalname.
 * @param {{folder?:string}} opts
 * @returns {Promise<{url:string, pathname:string, size:number}>}
 */
async function putUpload(file, opts = {}) {
  const folder = opts.folder || 'uploads';
  const ext = path.extname(file.originalname || '').toLowerCase();
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;

  if (enabled()) {
    const { put } = api();
    const res = await put(key, file.buffer || fs.readFileSync(file.path), {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.mimetype || undefined,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    return { url: res.url, pathname: res.pathname, size: file.size || 0, storage: 'vercel-blob' };
  }

  // Local fallback — write to public/uploads/ so static middleware serves it.
  const UPLOAD_DIR = process.env.RWP_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = path.basename(key);
  const abs = path.join(UPLOAD_DIR, filename);
  if (file.buffer) fs.writeFileSync(abs, file.buffer);
  else if (file.path) fs.copyFileSync(file.path, abs);
  return { url: '/uploads/' + filename, pathname: filename, size: file.size || 0, storage: 'local' };
}

async function deleteUpload(url) {
  if (!url) return;
  if (enabled() && /^https?:\/\//i.test(url)) {
    try {
      const { del } = api();
      await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch (err) {
      // Deleting a missing blob is not worth failing over.
      console.warn('[blob] delete failed:', url, err && err.message);
    }
    return;
  }
  // Local file path like "/uploads/foo.jpg"
  if (url.startsWith('/uploads/')) {
    const UPLOAD_DIR = process.env.RWP_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
    const abs = path.join(UPLOAD_DIR, path.basename(url));
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch (_) { /* locked file on Windows; ignore */ }
    }
  }
}

function inferFileType(mimetype, filename) {
  const mt = String(mimetype || '').toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('application/pdf') || /\.pdf$/i.test(filename || '')) return 'document';
  if (/\.(docx?|xlsx?|pptx?)$/i.test(filename || '')) return 'document';
  return 'file';
}

module.exports = { enabled, putUpload, deleteUpload, inferFileType };
