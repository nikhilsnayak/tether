interface RuntimeTextEncoder {
  readonly encode: (input?: string) => Uint8Array;
}

interface RuntimeGlobals {
  readonly TextEncoder: new () => RuntimeTextEncoder;
}

const runtime = globalThis as typeof globalThis & RuntimeGlobals;
const textEncoder = new runtime.TextEncoder();

export const utf8ByteLength = (value: string): number => textEncoder.encode(value).byteLength;
