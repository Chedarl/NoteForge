import "server-only";

import { deflateRawSync, crc32 } from "zlib";

/**
 * A minimal ZIP writer.
 *
 * Forty lines of buffer arithmetic against a dependency, and the dependency
 * loses. This runs on a serverless function that handles clinical text, and
 * every package added there is another maintainer, another update to track and
 * another supply-chain surface — for a file format whose specification has not
 * changed since 1993 and whose subset we need is entirely mechanical.
 *
 * Deliberately limited: no ZIP64, no encryption, no directory entries, no
 * streaming. Everything is assembled in memory, which is right for an export
 * that is measured in megabytes and wrong for one measured in gigabytes. If
 * batch exports ever reach that size, the fix is pagination by date range,
 * which the UI already offers — not a bigger ZIP writer.
 */

interface Entry {
  path: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
  offset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

/** DOS date/time. Second precision is 2 seconds; the format is from 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(files: { path: string; content: string | Buffer }[]): Buffer {
  const now = new Date();
  const { time, date } = dosDateTime(now);

  const entries: Entry[] = [];
  const localChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const nameBytes = Buffer.from(file.path, "utf8");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(20, 4); // version needed
    // Bit 11: the filename is UTF-8. Without it a path with an accented
    // character unzips to mojibake on Windows.
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8); // method: deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // extra field length

    localChunks.push(header, nameBytes, compressed);
    entries.push({ path: file.path, data, crc, compressed, offset });
    offset += header.length + nameBytes.length + compressed.length;
  }

  const centralChunks: Buffer[] = [];
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, "utf8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(SIG_CENTRAL, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk number
    header.writeUInt16LE(0, 36); // internal attrs
    header.writeUInt32LE(0, 38); // external attrs
    header.writeUInt32LE(entry.offset, 42);

    centralChunks.push(header, nameBytes);
    centralSize += header.length + nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, ...centralChunks, end]);
}

/**
 * Makes a string safe as a path segment inside the archive.
 *
 * Strips anything that could escape the extraction directory or break on
 * Windows. Belt and braces — every path this module builds is assembled from
 * client codes and ISO dates — but an export lands in somebody's Downloads
 * folder and gets double-clicked, and that is not the place to be relying on
 * an upstream invariant.
 */
export function safeSegment(input: string): string {
  return (
    input
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\.\./g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 80) || "unnamed"
  );
}
