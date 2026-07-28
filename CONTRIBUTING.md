# Contributing

Thank you for your interest in the Brewet community plugin for Red Hat OpenShift AI Dashboard.

## How to Contribute

1. Fork the repository and create a feature branch from `dev`.
2. Make your changes and ensure tests and lint pass across all three components:

   ```bash
   # Frontend
   npm test
   npm run lint

   # BFF
   cd bff && npm test && npm run lint

   # Storage Backend
   cd storage-backend && npm test && npm run lint
   ```

3. Submit a pull request targeting `dev` with a clear description of the change.

## Development Setup

Brewet has three components — install dependencies for each one you're working on:

```bash
npm install                          # Frontend
cd bff && npm install                # BFF
cd storage-backend && npm install    # Storage Backend
```

See [docs/development/LOCAL_SETUP.md](docs/development/LOCAL_SETUP.md) for the full local development guide.

## Reporting Issues

Please use [GitHub Issues](https://github.com/rh-ai-community-plugins/brewet/issues) to report bugs or suggest improvements.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
