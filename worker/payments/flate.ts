// zlib (PDF's FlateDecode) through the Web streams every Worker has. Deterministic for the same input and runtime.

async function through(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const done = new Response(transform.readable).arrayBuffer();
  const written = writer.write(bytes as unknown as BufferSource).then(() => writer.close());
  const [result] = await Promise.all([done, written]);
  return new Uint8Array(result);
}

export const deflate = (bytes: Uint8Array): Promise<Uint8Array> => through(bytes, new CompressionStream("deflate"));
export const inflate = (bytes: Uint8Array): Promise<Uint8Array> => through(bytes, new DecompressionStream("deflate"));
