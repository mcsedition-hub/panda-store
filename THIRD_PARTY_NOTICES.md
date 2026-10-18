# Composants et ressources tiers

La licence LGPLv3 du projet ne remplace pas les licences de ses dépendances.
Les listes de versions sont dans requirements*.txt et web/package-lock.json.
Chaque dépendance conserve sa licence distribuée avec son paquet.

## Polices embarquées

**Apfel Grotezk**, Luigi Gorlero / Collletttivo : titres, fichier WOFF2 Mittel.

**Ronzino**, Luigi Gorlero et Nunzio Mazzaferro / Collletttivo : interface,
fichiers WOFF2 Regular et Medium.

**IBM Plex Sans**, IBM : tracés du logotype existant, texte converti en contours.

Les textes SIL Open Font License et notices d'auteurs sont conservés dans
`web/public/fonts/licenses/` et distribués avec le frontend. Les polices ne sont
pas revendiquées comme des créations de Panda Store.
Le rendu vidéo utilise également Ronzino Regular ; sa police et sa licence sont
distribuées dans `addons/studio/fonts/`.

## Identité Panda Store

Les symboles et compositions de marque ont été créés pour ce projet. Les
illustrations de modules ont été produites avec GPT Image, puis exportées en
WebP transparent pour l'interface. Elles ne constituent pas des captures de
fonctions déjà disponibles. Aucune exclusivité juridique de ces images générées
n'est affirmée.

Odoo a servi de référence pour l'organisation modulaire et la variation des
familles de couleurs. Aucun code, logo, icône ou illustration Odoo n'est repris.
Les noms App Store, Apple, Google Play et autres services appartiennent à leurs
titulaires. Le projet n'affirme ni affiliation ni certification par ces services.

## Research browser sandbox profile

`deploy/research-seccomp.json` is the Playwright Docker seccomp profile from
Microsoft's Playwright project, retrieved on 2026-10-17:
https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json.
It retains Docker's syscall restrictions while allowing Chromium's user namespaces.
Copyright Microsoft Corporation. Licensed under Apache License 2.0; a copy is in
`deploy/PLAYWRIGHT-LICENSE.txt`.
