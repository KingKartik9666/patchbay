import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';

// A small ZIP32 writer for the bounded Windows release payload. Fixed timestamps
// and entry order make the archive repeatable for identical input bytes.
export function createZip(entries) {
  const local = [],
    central = [],
    seen = new Set();
  let offset = 0;
  for (const [name, data] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assert.ok(
      !seen.has(name) &&
        name.length &&
        !name.startsWith('/') &&
        !name.includes('\\') &&
        name.split('/').every((part) => part && part !== '.' && part !== '..'),
      'Invalid ZIP path: ' + name,
    );
    seen.add(name);
    const filename = Buffer.from(name),
      compressed = deflateRawSync(data, { level: 9 });
    assert.ok(
      filename.length <= 65535 && data.length < 0xffffffff && compressed.length < 0xffffffff,
      'Release payload exceeds ZIP32 limits.',
    );
    const checksum = crc32(data),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8 filenames.
    header.writeUInt16LE(8, 8); // Raw DEFLATE.
    header.writeUInt16LE(33, 12); // 1980-01-01, 00:00:00.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  assert.ok(
    seen.size <= 65535 && offset + directory.length < 0xffffffff,
    'Release exceeds ZIP32 limits.',
  );
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(seen.size, 8);
  end.writeUInt16LE(seen.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
