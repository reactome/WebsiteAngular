/**
 * Write charset-snapshot.json: every charset the content service's JVM
 * knows, by its name and aliases, and how it reads and writes text, as
 * measured on that JVM -- for the charset a Content-Type or Accept names
 * (body.ts: mediaType, plainText, encodeText).
 *
 *   JAVA=<the java the content service runs on> node tools/content-node/snapshot-charsets.ts
 *
 * Node's TextDecoder knows another set of names (x-user-defined, which Java
 * does not; cp437 and the EBCDIC code pages, which only Java knows), so the
 * names are Java's own: Charset.availableCharsets() and each one's aliases,
 * which is what Charset.forName and Tomcat's B2CConverter look a name up in.
 * For each charset:
 *
 *  - `encode`: how StringHttpMessageConverter writes printable ASCII in it
 *    (an OutputStreamWriter, flushed, never closed): "ascii" where the bytes
 *    are the text's own; otherwise the bytes written first (`prefix`, a
 *    byte-order mark) and each character's bytes after, checked to make up
 *    the whole text written at once; null where the JVM has no encoder.
 *  - `table`: for a single-byte charset, the character each byte reads as
 *    (U+FFFD for one it does not map), checked against all 256 read at once;
 *    and for a shifting one (EBCDIC's double-byte code pages), the same for
 *    the bytes before any shift, `unread` naming the shift bytes, which read
 *    as nothing alone.
 *  - `low`: what printable ASCII, tab, CR and LF each read as, alone and
 *    together the same (in that order: 0x20 to 0x7E, then tab, CR, LF);
 *    absent where they do not read one by one (a double-byte code page).
 *
 * WHEN TO RUN IT: when the content service's JVM changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'charset-snapshot.json');
const JAVA = process.env['JAVA'];
if (!JAVA) {
  console.error('JAVA: the java executable the content service runs on');
  process.exit(2);
}

const PROGRAM = `
import java.io.*;
import java.nio.charset.*;
import java.util.*;

public class Charsets {
  static String hex(byte[] bytes) {
    StringBuilder b = new StringBuilder();
    for (byte x : bytes) b.append(String.format("%02x", x & 0xff));
    return b.toString();
  }
  static byte[] write(String text, Charset cs) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    Writer writer = new OutputStreamWriter(out, cs);
    writer.write(text);
    writer.flush();
    return out.toByteArray();
  }
  static String read(byte[] bytes, Charset cs) throws IOException {
    Reader reader = new InputStreamReader(new ByteArrayInputStream(bytes), cs);
    StringBuilder b = new StringBuilder();
    char[] buffer = new char[4096];
    for (int n; (n = reader.read(buffer)) != -1; ) b.append(buffer, 0, n);
    return b.toString();
  }
  static String json(String s) {
    StringBuilder b = new StringBuilder("\\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
      else if (c < 0x20 || c > 0x7e) b.append(String.format("\\\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }
  public static void main(String[] args) throws IOException {
    StringBuilder printable = new StringBuilder();
    for (char c = 0x20; c < 0x7f; c++) printable.append(c);
    String ascii = printable.toString();
    byte[] readable = (ascii + "\\t\\r\\n").getBytes(StandardCharsets.US_ASCII);
    List<String> out = new ArrayList<>();
    for (Charset cs : Charset.availableCharsets().values()) {
      StringBuilder e = new StringBuilder();
      e.append("{\\"name\\":").append(json(cs.name())).append(",\\"aliases\\":[");
      List<String> aliases = new ArrayList<>(cs.aliases());
      Collections.sort(aliases);
      for (int i = 0; i < aliases.size(); i++) e.append(i == 0 ? "" : ",").append(json(aliases.get(i)));
      e.append("],\\"encode\\":");
      if (!cs.canEncode()) e.append("null");
      else {
        byte[] whole = write(ascii, cs);
        if (Arrays.equals(whole, ascii.getBytes(StandardCharsets.US_ASCII))) e.append("\\"ascii\\"");
        else {
          List<String> chars = new ArrayList<>();
          ByteArrayOutputStream joined = new ByteArrayOutputStream();
          byte[] prefix = null;
          boolean regular = true;
          for (char c : ascii.toCharArray()) {
            byte[] one = write(String.valueOf(c), cs);
            if (prefix == null) {
              // The prefix is what a one-character write has before the
              // character, the same for every character.
              byte[] two = write("  ", cs);
              // two spaces = prefix + s + s, one = prefix + s.
              int sLength = two.length - one.length;
              int p = one.length - sLength;
              if (p < 0) { regular = false; break; }
              prefix = Arrays.copyOf(one, p);
              joined.write(prefix);
            }
            if (one.length < prefix.length || !Arrays.equals(Arrays.copyOf(one, prefix.length), prefix)) { regular = false; break; }
            byte[] rest = Arrays.copyOfRange(one, prefix.length, one.length);
            chars.add(json(hex(rest)));
            joined.write(rest);
          }
          if (!regular || !Arrays.equals(joined.toByteArray(), whole)) e.append("\\"irregular\\"");
          else e.append("{\\"prefix\\":").append(json(hex(prefix))).append(",\\"chars\\":").append(chars).append("}");
        }
      }
      // A single-byte charset -- every byte one character, read alone or
      // together -- or a shifting one (EBCDIC's double-byte code pages) as
      // long as no shift-out or shift-in byte comes.
      StringBuilder table = new StringBuilder();
      List<Integer> unread = new ArrayList<>();
      ByteArrayOutputStream readAlone = new ByteArrayOutputStream();
      for (int b = 0; b < 256; b++) {
        String one = read(new byte[] {(byte) b}, cs);
        if (one.length() == 1) { table.append(one); readAlone.write(b); }
        else { table.append('\\uffff'); unread.add(b); }
      }
      StringBuilder expected = new StringBuilder();
      for (int i = 0; i < 256; i++) if (!unread.contains(i)) expected.append(table.charAt(i));
      boolean shifts = !unread.isEmpty() && unread.stream().allMatch(b -> b == 0x0e || b == 0x0f);
      if ((unread.isEmpty() && cs.newDecoder().maxCharsPerByte() == 1f || shifts)
          && read(readAlone.toByteArray(), cs).equals(expected.toString())) {
        e.append(",\\"table\\":").append(json(table.toString()));
        if (shifts) e.append(",\\"unread\\":").append(unread);
      }
      // Printable ASCII, tab, CR and LF: each byte alone, if all together read the same.
      StringBuilder low = new StringBuilder();
      boolean lowReads = true;
      for (byte b : readable) {
        String one = read(new byte[] {b}, cs);
        if (one.length() != 1) { lowReads = false; break; }
        low.append(one);
      }
      if (lowReads && read(readable, cs).equals(low.toString()))
        e.append(",\\"low\\":").append(json(low.toString()));
      out.add(e.append("}").toString());
    }
    System.out.print("{\\"charsets\\":[" + String.join(",\\n", out) + "]}");
  }
}
`;

const dir = mkdtempSync(path.join(tmpdir(), 'charsets-'));
try {
  const source = path.join(dir, 'Charsets.java');
  writeFileSync(source, PROGRAM);
  // A single source file runs without compiling first (JDK 11+).
  const text = execFileSync(JAVA, [source], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const parsed = JSON.parse(text) as { charsets: { name: string }[] };
  writeFileSync(OUT, `${JSON.stringify(parsed, null, 1)}\n`);
  console.log(`${OUT}: ${parsed.charsets.length} charsets`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
