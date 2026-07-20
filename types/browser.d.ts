interface Window {
  webkitAudioContext?: typeof AudioContext;
  obsstudio?: {
    startRecording(): void;
    stopRecording(): void;
  };
}
