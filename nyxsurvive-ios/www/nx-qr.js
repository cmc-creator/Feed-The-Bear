/* nx-qr.js - a small, self-contained QR Code encoder for
 * NyxSurvive (money build D, QR Squad Sync). Byte mode, error
 * correction level M, automatic version selection (1-40),
 * rendered to a canvas. Written for this app: no external
 * dependency, no CDN, works fully offline like the rest of the
 * shell. The block tables below are the ISO/IEC 18004 error
 * correction characteristics for level M.
 *
 * Exposes window.NXQR:
 *   encode(text) -> { version, size, modules } | null
 *     modules is a size x size array of 0/1 (1 = dark), WITHOUT
 *     the quiet zone. null when the text fits no version.
 *   draw(canvas, text) -> boolean
 *     paints the code (black on white, 4-module quiet zone) at
 *     the largest whole-module scale that fits ~360px.
 *   byteCapacity(version) -> max UTF-8 bytes at that version.
 */
(function () {
  "use strict";

  /* ---- error correction table, level M -------------------
   * Per version: groups of [block count, total codewords per
   * block, data codewords per block]. Group 1 blocks are the
   * short ones; group 2 (when present) holds one more data
   * codeword each. */
  var ECC_M = [
    [[1, 26, 16]],
    [[1, 44, 28]],
    [[1, 70, 44]],
    [[2, 50, 32]],
    [[2, 67, 43]],
    [[4, 43, 27]],
    [[4, 49, 31]],
    [[2, 60, 38], [2, 61, 39]],
    [[3, 58, 36], [2, 59, 37]],
    [[4, 69, 43], [1, 70, 44]],
    [[1, 80, 50], [4, 81, 51]],
    [[6, 58, 36], [2, 59, 37]],
    [[8, 59, 37], [1, 60, 38]],
    [[4, 64, 40], [5, 65, 41]],
    [[5, 65, 41], [5, 66, 42]],
    [[7, 73, 45], [3, 74, 46]],
    [[10, 74, 46], [1, 75, 47]],
    [[9, 69, 43], [4, 70, 44]],
    [[3, 70, 44], [11, 71, 45]],
    [[3, 67, 41], [13, 68, 42]],
    [[17, 68, 42]],
    [[17, 74, 46]],
    [[4, 75, 47], [14, 76, 48]],
    [[6, 73, 45], [14, 74, 46]],
    [[8, 75, 47], [13, 76, 48]],
    [[19, 74, 46], [4, 75, 47]],
    [[22, 73, 45], [3, 74, 46]],
    [[3, 73, 45], [23, 74, 46]],
    [[21, 73, 45], [7, 74, 46]],
    [[19, 75, 47], [10, 76, 48]],
    [[2, 74, 46], [29, 75, 47]],
    [[10, 74, 46], [23, 75, 47]],
    [[14, 74, 46], [21, 75, 47]],
    [[14, 74, 46], [23, 75, 47]],
    [[12, 75, 47], [26, 76, 48]],
    [[6, 75, 47], [34, 76, 48]],
    [[29, 74, 46], [14, 75, 47]],
    [[13, 74, 46], [32, 75, 47]],
    [[40, 75, 47], [7, 76, 48]],
    [[18, 75, 47], [31, 76, 48]]
  ];
  /* Alignment pattern centers per version (index 0 = v2). */
  var ALIGN = [
    [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
    [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82],
    [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];

  function dataCodewords(version) {
    var groups = ECC_M[version - 1], total = 0, i, g;
    for (i = 0; i < groups.length; i++) { g = groups[i]; total += g[0] * g[2]; }
    return total;
  }
  function byteCapacity(version) {
    var headerBits = version <= 9 ? 12 : 20; // mode (4) + count (8 or 16)
    return Math.floor((dataCodewords(version) * 8 - headerBits) / 8);
  }

  /* ---- Galois field GF(256), primitive polynomial 0x11D -- */
  var GF_EXP = new Array(512), GF_LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) {
      GF_EXP[i] = x; GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();
  function gfMul(a, b) { return (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0; }

  /* Reed-Solomon: generator polynomial of degree n, and the
   * error correction codewords for one data block. The
   * generator is built root by root (x - 2^0)(x - 2^1)... in
   * the shift-register coefficient layout the remainder loop
   * below consumes. */
  function rsGenerator(n) {
    var result = [], i, j;
    for (i = 0; i < n; i++) result.push(0);
    result[n - 1] = 1;
    var root = 1;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < n) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, gen) {
    var res = [], i, j;
    for (i = 0; i < gen.length; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (j = 0; j < gen.length; j++) res[j] ^= gfMul(gen[j], factor);
    }
    return res;
  }

  function utf8Bytes(text) {
    var out = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length &&
               text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(i + 1) - 0xDC00);
        i++;
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return out;
  }

  /* Assemble the full codeword sequence (data interleaved,
   * then EC interleaved) for the given version + payload. */
  function buildCodewords(version, bytes) {
    var capacity = dataCodewords(version);
    var bits = [], i, j;
    function pushBits(val, len) {
      for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1);
    }
    pushBits(0x4, 4); // byte mode
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    var capBits = capacity * 8;
    var term = Math.min(4, capBits - bits.length);
    for (i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    var pads = [0xEC, 0x11], p = 0;
    while (data.length < capacity) data.push(pads[p++ % 2]);

    // Split into blocks and compute EC per block.
    var groups = ECC_M[version - 1];
    var blocks = [], ecBlocks = [], off = 0, maxData = 0;
    for (i = 0; i < groups.length; i++) {
      var count = groups[i][0], totalPer = groups[i][1], dataPer = groups[i][2];
      var gen = rsGenerator(totalPer - dataPer);
      for (j = 0; j < count; j++) {
        var block = data.slice(off, off + dataPer);
        off += dataPer;
        blocks.push(block);
        ecBlocks.push(rsRemainder(block, gen));
        if (dataPer > maxData) maxData = dataPer;
      }
    }
    var out = [];
    for (i = 0; i < maxData; i++)
      for (j = 0; j < blocks.length; j++)
        if (i < blocks[j].length) out.push(blocks[j][i]);
    var ecLen = ecBlocks[0].length;
    for (i = 0; i < ecLen; i++)
      for (j = 0; j < ecBlocks.length; j++) out.push(ecBlocks[j][i]);
    return out;
  }

  /* ---- matrix construction ------------------------------- */
  function newGrid(size, val) {
    var g = [], i;
    for (i = 0; i < size; i++) {
      var row = [];
      for (var j = 0; j < size; j++) row.push(val);
      g.push(row);
    }
    return g;
  }

  function drawFunctionPatterns(modules, isFunc, version) {
    var size = modules.length, i, j;
    function set(x, y, dark) {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        modules[y][x] = dark ? 1 : 0;
        isFunc[y][x] = 1;
      }
    }
    // Timing patterns.
    for (i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    // Finder patterns with separators.
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // Alignment patterns (skipping the three finder corners).
    if (version >= 2) {
      var pos = ALIGN[version - 2];
      for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
        var cx = pos[i], cy = pos[j];
        var nearFinder = (cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9);
        if (nearFinder) continue;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    // Reserve the format information cells (values drawn
    // later, once the mask is known) and the dark module.
    // Exactly the format path - the timing cells at (8, 6)
    // and (6, 8) are NOT part of it and stay untouched.
    var fmt1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    for (i = 0; i < fmt1.length; i++) set(fmt1[i][0], fmt1[i][1], false);
    for (i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
    set(8, size - 8, true); // dark module
    // Version information for version 7+.
    if (version >= 7) {
      var rem = version;
      for (i = 0; i < 12; i++) {
        rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
      }
      var bits = (version << 12) | (rem & 0xFFF);
      for (i = 0; i < 18; i++) {
        var bit = ((bits >>> i) & 1) === 1;
        set(size - 11 + (i % 3), Math.floor(i / 3), bit);
        set(Math.floor(i / 3), size - 11 + (i % 3), bit);
      }
    }
  }

  function drawFormat(modules, mask) {
    var size = modules.length;
    // Level M indicator bits are 00: data = mask alone.
    var data = mask, rem = data;
    var i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    var bits = ((data << 10) | (rem & 0x3FF)) ^ 0x5412;
    function bit(k) { return ((bits >>> k) & 1) === 1; }
    function set(x, y, dark) { modules[y][x] = dark ? 1 : 0; }
    // First copy, around the top-left finder.
    var pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    for (i = 0; i < 15; i++) set(pos1[i][0], pos1[i][1], bit(i));
    // Second copy, split along the other two finders.
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // dark module
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
  ];

  function penalty(modules) {
    var size = modules.length, score = 0, x, y, i;
    // Rule 1: runs of 5+ same-color modules in rows and columns.
    function runPenalty(line) {
      var s = 0, run = 1;
      for (var k = 1; k <= line.length; k++) {
        if (k < line.length && line[k] === line[k - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      return s;
    }
    for (y = 0; y < size; y++) {
      score += runPenalty(modules[y]);
      var col = [];
      for (x = 0; x < size; x++) col.push(modules[x][y]);
      score += runPenalty(col);
    }
    // Rule 2: 2x2 blocks of one color.
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var v = modules[y][x];
      if (modules[y][x + 1] === v && modules[y + 1][x] === v && modules[y + 1][x + 1] === v) score += 3;
    }
    // Rule 3: finder-like patterns with a 4-module light guard.
    function patternPenalty(line) {
      var s = 0;
      for (var k = 0; k + 11 <= line.length; k++) {
        var w = 0;
        for (var m = 0; m < 11; m++) w = (w << 1) | line[k + m];
        if (w === 0b10111010000 || w === 0b00001011101) s += 40;
      }
      return s;
    }
    for (y = 0; y < size; y++) {
      score += patternPenalty(modules[y]);
      var col2 = [];
      for (x = 0; x < size; x++) col2.push(modules[x][y]);
      score += patternPenalty(col2);
    }
    // Rule 4: deviation from a 50% dark ratio, in 5% steps.
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (modules[y][x]) dark++;
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    if (k > 0) score += k * 10;
    return score;
  }

  function encode(text) {
    if (typeof text !== "string" || !text) return null;
    var bytes = utf8Bytes(text);
    var version = 0, v;
    for (v = 1; v <= 40; v++) {
      if (bytes.length <= byteCapacity(v)) { version = v; break; }
    }
    if (!version) return null;
    var size = version * 4 + 17;
    var codewords = buildCodewords(version, bytes);
    var bits = [];
    var i, j;
    for (i = 0; i < codewords.length; i++)
      for (j = 7; j >= 0; j--) bits.push((codewords[i] >>> j) & 1);

    var base = newGrid(size, 0), isFunc = newGrid(size, 0);
    drawFunctionPatterns(base, isFunc, version);
    // Place the data bits in the standard zigzag, upward from
    // the bottom-right, skipping column 6. Modules beyond the
    // bitstream (remainder bits) stay 0 but are still masked.
    var bitIdx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunc[y][x]) {
            base[y][x] = bitIdx < bits.length ? bits[bitIdx] : 0;
            bitIdx++;
          }
        }
      }
    }
    // Try every mask; keep the lowest penalty.
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var m = 0; m < 8; m++) {
      var cand = newGrid(size, 0);
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        cand[yy][xx] = base[yy][xx];
        if (!isFunc[yy][xx] && MASKS[m](xx, yy)) cand[yy][xx] ^= 1;
      }
      drawFormat(cand, m);
      var s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; bestMask = m; }
    }
    return { version: version, size: size, mask: bestMask, modules: best };
  }

  function draw(canvas, text) {
    var enc = encode(text);
    if (!enc || !canvas || !canvas.getContext) return false;
    var quiet = 4;
    var cells = enc.size + quiet * 2;
    var scale = Math.max(1, Math.floor(360 / cells));
    canvas.width = cells * scale;
    canvas.height = cells * scale;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (var y = 0; y < enc.size; y++) for (var x = 0; x < enc.size; x++) {
      if (enc.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
    return true;
  }

  window.NXQR = {
    encode: encode,
    draw: draw,
    byteCapacity: byteCapacity,
    dataCodewords: dataCodewords
  };
})();
