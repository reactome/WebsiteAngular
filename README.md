# Reactome

REACTOME is an open-source, open access, manually curated and peer-reviewed pathway database.

## Local Development Server
To setup a local environment

```bash
npm install --legacy-peer-deps
npm start
```

## Usage
Reactome has a wide range of features, to explore more of Reactome or get more information visit [the documentation page](https://reactome.org/documentation) or see the ````/documentation```` folder in the root directory.

## Configuration

The application configuration is centralized in TypeScript files under `projects/website-angular/src/config/`. Key configurations include:

- `config.ts`: App-level settings like version, base URLs, and feature flags.
- `environments.ts`: Environment-specific settings (development, production, etc.).
- `api-routes.ts`: API endpoint URLs derived from the current environment.
- `features.ts`: Feature flags for toggling functionality.
- `external-links.ts`: External links, including dynamically constructed release notes.

To update configuration values, edit the respective TS files. For environment-specific builds, consider using Angular's file replacements in `angular.json`.

## Additional Resources

## LICENSE
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
