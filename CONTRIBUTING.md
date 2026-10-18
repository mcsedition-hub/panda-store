# Contributing to Panda Store

Start with an issue describing a reproducible problem or a proposed module.
Include the need, steps, expected result and version. Never attach keys, passwords
or private store data.

The project is an alpha under LGPLv3. Contributions to the community edition use
this license, and authors retain their rights. Check the licenses and notices of
any third-party code included in a proposal. See the [license policy](docs/licensing.md).

To build a module, follow the [module guide](docs/modules.md), use a dedicated branch
and keep the change focused on one need. Include required migrations, documentation
and tests for behavior and permissions. Run the [development checks](docs/development.md#checks)
and report any untested limitations.

## Language

Use English for repository documentation, module READMEs, issues, pull requests
and new commit messages. The main introduction is available in `README.md` and
`README.fr.md`; keep these two versions aligned when updating it. Other documentation
has one English version. The application supports English and French through its
translation files; preserve both languages when changing interface text.

Proposed features must not present fictional results as real data or promise a
guaranteed number of downloads. External sources and their access conditions
must be explicit.

For a security vulnerability, follow [SECURITY.md](SECURITY.md).
