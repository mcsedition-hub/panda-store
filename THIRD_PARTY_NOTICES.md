# Third-party components and assets

The project's LGPLv3 license does not replace the licenses of its dependencies.
Pinned versions are in requirements*.txt and web/package-lock.json. Each dependency
retains the license distributed with its package.

## Bundled fonts

**Apfel Grotezk**, Luigi Gorlero / Collletttivo: headings, Mittel WOFF2 file.

**Ronzino**, Luigi Gorlero and Nunzio Mazzaferro / Collletttivo: interface,
Regular and Medium WOFF2 files.

**IBM Plex Sans**, IBM: existing logotype paths, with text converted to outlines.

The SIL Open Font License texts and author notices are preserved in
`web/public/fonts/licenses/` and distributed with the frontend. These fonts are not
claimed as Panda Store creations. Video rendering also uses Ronzino Regular;
its font and license are distributed in `addons/studio/fonts/`.

## Panda Store identity

The brand symbols and compositions were created for this project. Module
illustrations were produced with GPT Image and exported as transparent WebP files
for the interface. They are not screenshots of available features. No exclusive
legal rights are claimed over these generated images.

Odoo served as a reference for the modular organization and color families.
No Odoo code, logo, icon or illustration is reused. App Store, Apple, Google Play
and other service names belong to their respective owners. The project claims
no affiliation with or certification by these services.

## Research browser sandbox profile

`deploy/research-seccomp.json` is the Playwright Docker seccomp profile from
Microsoft's Playwright project, retrieved on 2026-10-17:
https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json.
It retains Docker's syscall restrictions while allowing Chromium's user namespaces.
Copyright Microsoft Corporation. Licensed under Apache License 2.0; a copy is in
`deploy/PLAYWRIGHT-LICENSE.txt`.
