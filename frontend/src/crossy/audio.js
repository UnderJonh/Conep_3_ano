// The upstream game already mutes Expo audio on web.
export function createAudioPlayer() { return { play() {}, pause() {}, seekTo() {} }; }
