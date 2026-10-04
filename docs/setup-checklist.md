# Setup checklist (Phase 0.2)

One-time steps done by hand in GitHub and Cloudflare. Menu names change from time to time; if something isn't where this says, use the dashboard's search.

## 1. Protect the accounts (do this first)

- [ ] **GitHub:** turn on two-factor authentication with a passkey or security key (Settings → Password and authentication). Store the recovery codes offline.
- [ ] **Cloudflare:** turn on two-factor authentication, with a security key or passkey if offered (My Profile → Authentication).
- [ ] **The email account behind GitHub and Cloudflare:** passkey or two-factor authentication too, because account recovery goes through it.
- [ ] _Optional:_ create a free npm account or organization named `shkriuss` to reserve the `@shkriuss` package scope, so nobody can publish look-alike packages under it.

## 2. Both domains in Cloudflare (`shkriuss.app` and `shkriuss.dev`)

- [ ] **Registrar:** auto-renew on, wherever the domain is registered.
- [ ] **DNSSEC:** enable it (DNS → Settings). For domains registered with Cloudflare Registrar the DS record is added automatically; otherwise copy it to your registrar.
- [ ] **SSL/TLS → Edge Certificates:** Always Use HTTPS on; Minimum TLS Version 1.2; TLS 1.3 on.
- [ ] **CAA records**, allowing only the certificate authorities Cloudflare uses:

  | Type | Name | Value                       |
  | ---- | ---- | --------------------------- |
  | CAA  | `@`  | `0 issue "letsencrypt.org"` |
  | CAA  | `@`  | `0 issue "pki.goog"`        |
  | CAA  | `@`  | `0 issue "ssl.com"`         |

- [ ] **Email anti-spoofing.** Neither domain sends email:

  | Type | Name     | Value                                            |
  | ---- | -------- | ------------------------------------------------ |
  | MX   | `@`      | `.` with priority 0 (a "null MX")                |
  | TXT  | `@`      | `v=spf1 -all`                                    |
  | TXT  | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` |

  If you ever want to receive email on one of these domains (for example with Cloudflare Email Routing), replace the null MX and SPF records at that point.

- [ ] **Keep these off.** They inject scripts or rewrite pages, which breaks our security policy:
  - Rocket Loader
  - Email Address Obfuscation (on by default for new domains)
  - Zaraz
  - Web Analytics automatic setup
  - Bot Fight Mode (its JavaScript detections inject a script)

- [ ] **Network → Network Error Logging Monitoring:** off. Cloudflare turns it on by default; its `NEL` and `Report-To` headers make browsers send reports about failed connections to `a.nel.cloudflare.com`. That is telemetry, which we never collect.

Cloudflare Access for staging is set up in Phase 0.3, when staging gets its first deployment.

## 3. GitHub repository `shkriuss/shkriuss.app`

**Now:**

- [ ] **About** (the gear next to "About" on the repository page):
  - description: "Private, offline-first web apps";
  - website: `https://shkriuss.app`;
  - topics: `pwa`, `local-first`, `offline-first`, `privacy`.
- [ ] **Settings → General → Features:** turn off Wikis, Projects and Discussions unless you plan to use them.
- [ ] **Settings → General → Pull Requests:**
  - allow **squash merging** only;
  - turn on "Always suggest updating pull request branches";
  - turn on "Automatically delete head branches".
- [ ] **Settings → Rules → Rulesets → New branch ruleset:**
  - name `main`, enforcement **Active**, target the default branch;
  - rules: Restrict deletions; Block force pushes; Require linear history; Require a pull request before merging, with 0 required approvals (you are the only maintainer);
  - leave the bypass list empty.
- [ ] **Settings → Code security** (may be labelled "Advanced Security"): turn on Private vulnerability reporting, Dependabot alerts, Dependabot security updates, and Secret scanning with push protection.
- [ ] **Settings → Actions → General:**
  - Workflow permissions: "Read repository contents and packages permissions";
  - uncheck "Allow GitHub Actions to create and approve pull requests";
  - fork pull request workflows: require approval for all external contributors.

**After the CI pull request (step 0.3a) is merged:**

- [ ] **`main` ruleset:** add "Require status checks to pass" with the checks **Verify**, **Workflow audit** and **Dependency review**, and turn on "Require branches to be up to date before merging".
- [ ] **Settings → Code security → Code scanning:** turn on CodeQL **default setup**.

**After the hub pull request (step 0.3b) is merged:**

- [ ] **`main` ruleset:** add **End-to-end** to the required status checks.

**Before the deployment pull request (step 0.3c) is merged:**

Cloudflare Access for staging comes first, so staging is never public:

- [ ] Open **Zero Trust** in the Cloudflare dashboard. Choose a team name, for example `shkriuss`, and the Free plan. It asks for a payment method, but the Free plan costs nothing.
- [ ] **Integrations → Identity providers:** add **One-time PIN**.
- [ ] **Access → Applications → Add an application → Self-hosted:**
  - add two public hostnames, `shkriuss.dev` and `*.shkriuss.dev`, because the wildcard does not cover the apex;
  - add a policy with the action **Allow** that includes **Emails** → your email address.

Cloudflare API tokens, one per environment (**My Profile → API Tokens → Create Token → Custom token**):

| Token name                  | Permissions                                                    | Resources                         |
| --------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `GitHub deploy: staging`    | Account → Workers Scripts → Edit; Zone → Workers Routes → Edit | your account; zone `shkriuss.dev` |
| `GitHub deploy: production` | Account → Workers Scripts → Edit; Zone → Workers Routes → Edit | your account; zone `shkriuss.app` |

- [ ] Give each token an expiry date, for example one year, and note it somewhere you will see it.
- [ ] Copy your **Account ID** from the account home page.
- [ ] Never paste a token anywhere but GitHub.

GitHub environments (**Settings → Environments → New environment**):

| Environment  | Deployment branches | Secret                                       | Variable                | Protection                                                      |
| ------------ | ------------------- | -------------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `staging`    | `main` only         | `CLOUDFLARE_API_TOKEN`: the staging token    | `CLOUDFLARE_ACCOUNT_ID` | none                                                            |
| `production` | `main` only         | `CLOUDFLARE_API_TOKEN`: the production token | `CLOUDFLARE_ACCOUNT_ID` | Required reviewers: you. Leave "Prevent self-review" turned off |

Optional, in both zones: redirect `www` to the apex ([ADR 0001](decisions/0001-domains-and-environments.md)).

- [ ] **DNS:** add a proxied `AAAA` record named `www` that points to `100::`.
- [ ] **Rules → Redirect Rules:** create a rule from the template "Redirect from WWW to root".

**After the deployment pull request (step 0.3c) is merged:**

- [ ] The CI run on `main` deploys to staging. Open `https://shkriuss.dev`; Access asks for your email and sends a one-time PIN.
- [ ] In the same run, approve the **production** deployment (**Review deployments**). Then open `https://shkriuss.app`.
- [ ] Scan `https://shkriuss.app` with the MDN HTTP Observatory. The target is A+.
