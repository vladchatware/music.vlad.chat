# Agentic music mixing

[Demo](https://clownz-army.kinsta.app)

## Project overview

- Frontend: vanillajs
- Backend: expressjs
- Runtime: bun

## External dependencies

1. Open AI: speech, transcriptions, responses
2. SoundCloud: tracks
3. OBS: record

## Architecture

Recursive loop that starts with a user input, hardcoded from the beginning but can be transcribed from the user voice, calls to soundcloud to search tracks via tool calling and vibes out the track.