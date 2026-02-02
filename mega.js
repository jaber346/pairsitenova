import { Storage } from 'megajs';

/**
 * ⚠️ REMPLACE ICI
 */
const email = 'jaberporgo@gmail.com';
const password = 'Djabir123';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const upload = async (data, name) => {
  if (!email || !password) {
    throw new Error('MEGA credentials missing');
  }

  if (typeof data === 'string') data = Buffer.from(data);

  const storage = await new Storage({ email, password, userAgent }).ready;

  try {
    const file = await storage
      .upload({ name, allowUploadBuffering: true }, data)
      .complete;

    const url = await file.link();
    return url;
  } finally {
    try {
      await storage.close();
    } catch {}
  }
};
