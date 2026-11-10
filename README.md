# shkriuss.app

An open-source suite of native Android apps, built from shared core modules.
Every app has an ID of the form `app.shkriuss.<name>`.

**Status: early development.** There are no releases yet. Nothing here is
ready to install.

## What it is

- **Local-first.** Every app works fully with no account and no network.
- **No Google services.** No Google Play services, Firebase, analytics, ads
  or trackers. No WebView.
- **No network in data apps.** A separate Sync app does all networking.
- **Optional sync.** End-to-end encrypted sync through a backend that each
  user deploys to their own Cloudflare account. The server only sees
  encrypted data.
- **GrapheneOS first.** Other Android systems come second. Minimum Android 13.

## Planned apps

In the order of the roadmap:

1. Catalog: a gallery of the shared design components, for development.
2. Water: the pilot app.
3. Reminders, then Tasks.
4. Notes.
5. Sync: the only app with network access. It moves encrypted data only.
6. Budget, Meals, Repairs, Shelf and Trades.
7. Calendar, with Georgian public holidays and Orthodox feasts computed on
   the device.
8. Drive, then Photos: encrypted vaults on the device, with optional sync.
9. Grammar: on-device grammar checking with the Harper engine.

## Documentation

- [Project plan](docs/plan/PLAN.md)
- [All documentation](docs/README.md)
- [User guides](docs/user/README.md)
- [Self-hosting the sync backend](docs/self-hosting/README.md)
- [Security](docs/security/README.md)
- [Architecture](docs/architecture/README.md)
- [Decision records](docs/adr/README.md)
- [Development](docs/development/README.md)

## Security

Please report security problems privately. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

- Apps: GPL-3.0. The full text is in [LICENSE](LICENSE).
- Sync backend: AGPL-3.0. Its licence file will live in `backend/`.

Open: whether the apps use "GPL-3.0-only" or "GPL-3.0-or-later".
