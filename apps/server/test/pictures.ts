/** Complete synthetic 2×3 pictures generated from solid colours; no customer data. */
import { randomBytes } from 'node:crypto';
const PNG_BASE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGMUSdnCwMDAxMDAgKAAFfgBMlRqiyUAAAAASUVORK5CYII=', 'base64');
const JPEG_BASE = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlKKKK+vPlT//Z', 'base64');
const PROGRESSIVE_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/9oADAMBAAIQAxAAAAGSFyv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEPv/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==', 'base64');
const WEBP = Buffer.from('UklGRjwAAABXRUJQVlA4IDAAAADwAQCdASoCAAMAAUAmJaACdLoB+AAETAAA/vDXA/9Js8TZ4mz5JH/zsGxLteAAAAA=', 'base64');
const LOSSLESS_WEBP = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAdQslKUtv+BiOh/AAA=', 'base64');
const ANIMATED_WEBP = Buffer.from('UklGRsQAAABXRUJQVlA4WAoAAAACAAAAAQAAAgAAQU5JTQYAAAAAAAAAAABBTk1GSAAAAAAAAAAAAAEAAAIAAGQAAAJWUDggMAAAADABAJ0BKgIAAwABQCYloAADcAD+8NcD//6TZ//SbP/6TZ8Ir//52D/70f+mPjMAAEFOTUZIAAAAAAAAAAAAAQAAAgAAZAAAAFZQOCAwAAAANAEAnQEqAgADAAAAJiWgAANwAP7rZF//+sr//5lf//Mr/fI///EOf1t/3KaxAAAA', 'base64');

/** A valid PNG metadata chunk makes each fixture distinct without changing its pixels. */
export function smallPng(seed = randomBytes(64)): Buffer {
  const data = Buffer.from(`fixture\0${seed.toString('hex')}`);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write('tEXt', 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([PNG_BASE.subarray(0, -12), chunk, PNG_BASE.subarray(-12)]);
}
/** A JPEG comment makes each fixture distinct and leaves the complete image intact. */
export function smallJpeg(seed = randomBytes(64)): Buffer {
  const comment = Buffer.alloc(seed.length + 4);
  comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(seed.length + 2, 2); seed.copy(comment, 4);
  return Buffer.concat([JPEG_BASE.subarray(0, 2), comment, JPEG_BASE.subarray(2)]);
}
export const smallWebp = () => Buffer.from(WEBP);
export const smallLosslessWebp = () => Buffer.from(LOSSLESS_WEBP);
export const smallAnimatedWebp = () => Buffer.from(ANIMATED_WEBP);
export const smallProgressiveJpeg = () => Buffer.from(PROGRESSIVE_JPEG);
