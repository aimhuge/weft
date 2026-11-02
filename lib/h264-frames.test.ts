import { describe, expect, it } from "vitest";
import { codecOf, frameReader, isKey } from "./h264-frames";

const framed = (...bytes: number[]) => Uint8Array.from([0, 0, 0, bytes.length, ...bytes]);

describe("frameReader", () => {
  it("hands over whole frames however the bytes are split", () => {
    const got: number[][] = [];
    const read = frameReader((f) => got.push([...f]));
    const a = framed(1, 2, 3);
    const b = framed(4);
    read(a.subarray(0, 2));
    expect(got).toEqual([]);
    read(a.subarray(2, 6));
    expect(got).toEqual([]);
    read(Uint8Array.from([...a.subarray(6), ...b]));
    expect(got).toEqual([[1, 2, 3], [4]]);
  });
});

describe("isKey", () => {
  it("tells an IDR slice from a delta", () => {
    expect(isKey(Uint8Array.from([0, 0, 1, 0x65, 9]))).toBe(true);
    expect(isKey(Uint8Array.from([0, 0, 1, 0x41, 9]))).toBe(false);
  });
});

describe("codecOf", () => {
  it("reads the codec from the SPS", () => {
    expect(codecOf(Uint8Array.from([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x33, 0xac]))).toBe("avc1.640033");
  });

  it("is null with no SPS, or one cut short", () => {
    expect(codecOf(Uint8Array.from([0, 0, 1, 0x41, 1, 2, 3]))).toBeNull();
    expect(codecOf(Uint8Array.from([0, 0, 1, 0x67, 0x64, 9]))).toBeNull();
  });
});
