# BSON Errors

## DK-B001: BSON Error

**Message:** Various BSON-related error messages

**Causes:**
- Malformed BSON data being parsed
- UTF-8 decoding failures (incomplete multi-byte sequences)
- Invalid BSON type encountered during parsing
- Buffer underflow when reading BSON document
- Unsupported BSON element type

**Solution:**
Ensure the BSON data is valid and complete. Common issues include:
- Truncated binary data during network transmission
- Corrupted data from storage
- Incompatible BSON version or invalid encoding

For UTF-8 decode errors, verify the string data is properly encoded. Check that multi-byte UTF-8 sequences are complete and not truncated.

---
