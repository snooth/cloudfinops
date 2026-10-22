# Changelog

All notable changes to the Cloud FinOps Portal are documented here.

## [1.0.1] - 2026-07-03

### Added
- Landing page with usage disclaimer and acknowledgement gate
- Fixed site footer across all pages
- Semver tracking — patch auto-increment on each release export
- `npm run version:bump` script for manual patch/minor/major bumps

### Changed
- Tagline updated to "Cloud budget estimation portal"
- System package import now applies all server and client files correctly
- Export packages include bumped version in filename and manifest

### Fixed
- ZIP export/import compatibility with archiver v8
- `.env.example` no longer blocked during package import

## [1.0.0] - 2026-07-01

### Added
- Portfolio dashboard with AUD cost estimates across 10 Azure applications
- T-shirt sizing (S/M/L/XL) with resource footprints and size comparison
- Cost drivers page — data ingestion, user growth, and archive storage simulations
- Custom application builder with persistent storage
- Azure region selector (AU East, AU Central, AU Central 2)
- Subscription and licence cost modelling per application
- Mobile-responsive layout with collapsible navigation
- Software version management — pack, import, and changelog
- Offline Azure pricing snapshot — local AUD rates for all AU regions (no internet required)

### Changed
- Bright white theme for improved readability
- Server binds to `0.0.0.0` for LAN access
