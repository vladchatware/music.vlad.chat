import { SuperpoweredGlue } from "./Superpowered.js";

self.onmessage = async (event) => {
  try {
    const Superpowered = await SuperpoweredGlue.Instantiate("", event.data.wasmUrl);

    const response = await fetch(event.data.load);
    if (!response.ok) throw new Error(`Audio fetch failed with HTTP ${response.status}`);
    const audiofileArrayBuffer = await response.arrayBuffer();
    const audiofileInWASMHeap = Superpowered.arrayBufferToWASM(audiofileArrayBuffer);
    const audioInMemoryFormat = Superpowered.Decoder.decodeToAudioInMemory(
      audiofileInWASMHeap,
      audiofileArrayBuffer.byteLength,
    );
    const bytes =
      48 + Superpowered.AudioInMemory.getSize(audioInMemoryFormat) * 4;
    const arrayBuffer = Superpowered.moveWASMToArrayBuffer(audioInMemoryFormat, bytes);
    self.postMessage({ __transfer__: arrayBuffer }, [arrayBuffer]);
  } catch (error) {
    self.postMessage({
      __error__: error instanceof Error ? error.message : String(error),
    });
  }
};
