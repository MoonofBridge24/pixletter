/**
 * 1×1 透明 GIF バイナリ。
 * 開封追跡ピクセルとして返却する（FR-API-02）。
 *
 * 重要: このバイト列は「透明インデックス 0 を指す LZW データ」で構成されている。
 * 以前の実装は GCE の透明色インデックス=0（白）に対し LZW が index=1（黒）を
 * 出力していたため、1×1 の「黒ドット」として表示されていた。
 * 編集する場合は必ずデコードして pixelIndex === transparentIndex を確認すること。
 *
 * 構成:
 *   GIF89a / 1x1 / GCT 2色(black,white) / GCE(transparent flag, index 0) /
 *   image descriptor / LZW min=2 data=0x44(clear + index0 + EOI) / trailer
 */
export const TRANSPARENT_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00,             // 1x1
  0x80, 0x00, 0x00,                   // GCT flag, 2 colors
  0x00, 0x00, 0x00,                   // color 0: black (marked transparent)
  0xff, 0xff, 0xff,                   // color 1: white
  0x21, 0xf9, 0x04,                   // GCE
  0x01, 0x00, 0x00, 0x00, 0x00,       // transparency flag on, transparent color index 0
  0x2c, 0x00, 0x00, 0x00, 0x00,       // image descriptor
  0x01, 0x00, 0x01, 0x00, 0x00,       // 1x1
  0x02, 0x01, 0x44, 0x00,             // LZW min code size 2, block: clear + index 0 + EOI
  0x3b,                               // trailer
]);
