export function byteRange(header, size) {
  if (!header) return { first: 0, length: size, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last || first >= size)
    return null;
  return { first, length: last - first + 1, status: 206 };
}

export function rangeHeaders(range, size) {
  if (!range) return { "Content-Range": "bytes */" + size };
  return {
    "Content-Length": range.length,
    ...(range.status === 206 ? {
      "Content-Range": `bytes ${range.first}-${range.first + range.length - 1}/${size}`,
    } : {}),
  };
}
