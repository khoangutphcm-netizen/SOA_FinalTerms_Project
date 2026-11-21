const problem = (status, message) => Object.assign(new Error(message), { status });
const profileColumns = `id,display_name AS alias,role,bio,avatar_updated_at AS "avatarVersion"`;

// Accept the small, browser-encoded JPEG used by the profile editor.
function readAvatar(encoded) {
  if (encoded === null) return null;
  if (typeof encoded !== "string" || encoded.length > 131072 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw problem(400, "Ảnh đại diện không hợp lệ.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 12 || bytes.length > 98304 ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length-2] !== 0xff || bytes[bytes.length-1] !== 0xd9) {
    throw problem(400, "Ảnh đại diện cần là JPG tối đa 96 KiB.");
  }
  for (let offset = 2; offset + 8 < bytes.length && bytes[offset] === 0xff;) {
    const marker = bytes[offset+1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset+2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset+5);
      const width = bytes.readUInt16BE(offset+7);
      if (width > 0 && width <= 256 && height > 0 && height <= 256) return bytes;
      break;
    }
    offset += 2 + length;
  }
  throw problem(400, "Ảnh đại diện cần là JPG tối đa 256 × 256 px.");
}

export const profileHandlers = {
  async profile(query, { userId }) {
    const [profile] = await query(
      `SELECT ${profileColumns} FROM public.users WHERE id=$1 AND status='ACTIVE'`, [userId],
    );
    if (!profile) throw problem(404, "Không tìm thấy hồ sơ.");
    return profile;
  },
  async "profile-save"(query, { userId, displayName, bio, avatarJpeg }) {
    const name = typeof displayName === "string" ? displayName.trim() : "";
    if (!name || name.length > 80 || typeof bio !== "string" || bio.trim().length > 240) {
      throw problem(400, "Nhập tên hiển thị tối đa 80 ký tự và giới thiệu tối đa 240 ký tự.");
    }
    const changeAvatar = avatarJpeg !== undefined;
    const avatar = changeAvatar ? readAvatar(avatarJpeg) : null;
    const [profile] = await query(
      `UPDATE public.users SET display_name=$2,bio=$3,
        avatar_jpeg=CASE WHEN $4 THEN $5::bytea ELSE avatar_jpeg END,
        avatar_updated_at=CASE WHEN NOT $4 THEN avatar_updated_at WHEN $5::bytea IS NULL THEN NULL ELSE now() END
        WHERE id=$1 AND status='ACTIVE' RETURNING ${profileColumns}`,
      [userId, name, bio.trim(), changeAvatar, avatar],
    );
    if (!profile) throw problem(404, "Không tìm thấy hồ sơ.");
    return profile;
  },
  async avatar(query, { userId }) {
    const [row] = await query(
      "SELECT avatar_jpeg FROM public.users WHERE id=$1 AND status='ACTIVE'", [userId],
    );
    if (!row?.avatar_jpeg) throw problem(404, "Chưa có ảnh đại diện.");
    return { jpeg: row.avatar_jpeg.toString("base64") };
  },
};
