// Stable in-memory key for a File. Same name+size+mtime ⇒ same extraction, so
// we never re-open a file we've already read this session. Shared by App and the
// extraction / generate hooks so they all key files identically.
export function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}
