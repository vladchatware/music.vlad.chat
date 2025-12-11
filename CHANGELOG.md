# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2024-07-15

### Added
- Dual-deck music playback with beat-matched track transitions
- BPM detection for tracks
- Crossfade functionality between tracks
- iOS Safari audio unlocking mechanism
- User-specific SoundCloud token retrieval in API endpoints
- @ai-sdk/mcp dependency for enhanced chat functionality
- Improved cue point detection using still periods and transient analysis
- Track filtering to include only streamable tracks in MCP handler

### Changed
- Updated MusicPlayer prompt to reflect Frutiger Aero style theme
- Enhanced AI instructions to prioritize user liked tracks
- Improved track metadata handling and search logic
- Updated import statements for createMCPClient in chat API
- Refined AI instructions to prevent repeating tracks in session
- Enhanced BackgroundImage component with gradient texture

### Fixed
- Esbuild version mismatch in bun.lock
- Conditional check for trial message limit in chat API
- Import statement alignment in chat API
- MusicPlayer prompt clarity and search specificity
- Layout and styling in MusicPlayer component
- Playback initiation error handling

### Chore
- Updated dependency versioning to use caret (^) for better compatibility
- Regenerated bun.lock for dependency consistency

## [0.0.2] - 2024-06-25

### Added
- Initial release with core music player functionality
- SoundCloud integration
- Basic chat API
- Track playback and management
