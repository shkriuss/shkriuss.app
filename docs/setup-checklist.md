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

  _On 2026-10-10 neither zone had the CAA records nor these email records ([threat model](threat-model.md#5-residual-risks-accepted), G2): both are still to do._

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
- [ ] **`main` ruleset,** once CodeQL has run on a pull request: add **CodeQL** to the required status checks ([ADR 0018](decisions/0018-quality-gates-as-enforced.md)). On 2026-10-10 the ruleset still lacked it.

**After the hub pull request (step 0.3b) is merged:**

- [ ] **`main` ruleset:** add **End-to-end** to the required status checks.

**Before the deployment pull request (step 0.3c) is merged:**

Cloudflare Access for staging comes first, so staging is never public. It is set up in the staging account ([ADR 0020](decisions/0020-deployment-accounts.md); see the tokens below):

- [ ] Open **Zero Trust** in the Cloudflare dashboard of the staging account. Choose a team name, for example `shkriuss`, and the Free plan. It asks for a payment method, but the Free plan costs nothing.
- [ ] **Integrations → Identity providers:** add **One-time PIN**.
- [ ] **Access → Applications → Add an application → Self-hosted:**
  - add two public hostnames, `shkriuss.dev` and `*.shkriuss.dev`, because the wildcard does not cover the apex;
  - add a policy with the action **Allow** that includes **Emails** → your email address.

Cloudflare API tokens, one per environment, **each in a Cloudflare account of its own** ([ADR 0020](decisions/0020-deployment-accounts.md)). Cloudflare's "Workers Scripts: Edit" covers every Worker of an account, so a staging token in the production account could replace the production Workers without the production approval. Staging therefore lives in a second account, which holds the `shkriuss.dev` zone, its Access application and the staging token. In each account, **My Profile → API Tokens → Create Token → Custom token**:

| Token name                  | Account                | Permissions                                                    | Resources                         |
| --------------------------- | ---------------------- | -------------------------------------------------------------- | --------------------------------- |
| `GitHub deploy: staging`    | the staging account    | Account → Workers Scripts → Edit; Zone → Workers Routes → Edit | that account; zone `shkriuss.dev` |
| `GitHub deploy: production` | the production account | Account → Workers Scripts → Edit; Zone → Workers Routes → Edit | that account; zone `shkriuss.app` |

- [ ] Give each token an expiry date, for example one year, and note it somewhere you will see it.
- [ ] Copy each account's **Account ID** from its home page: the `staging` environment gets the staging account's, `production` the production account's.
- [ ] Never paste a token anywhere but GitHub.
- [ ] Verify the separation: with the staging token, `curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <staging token>" https://api.cloudflare.com/client/v4/accounts/<production account id>/workers/scripts` prints `403`.

**Moving staging into its own account.** Until 2026-10-10 both environments shared one account, so the staging deploy could write production (ADR 0020, with the same steps):

- [ ] Create the second Cloudflare account and protect it as §1 says.
- [ ] Move the `shkriuss.dev` zone: a domain on Cloudflare Registrar can be moved to another account in the dashboard; otherwise add the zone in the new account and point the registrar's nameservers at the ones it gives. Re-enable DNSSEC in the new account and update the DS record at the registrar, then set §2 again for the zone: SSL/TLS, CAA, the email records, the features that stay off, Network Error Logging.
- [ ] Set up Zero Trust and the Access application in the new account, as above.
- [ ] Create the staging token there. In GitHub's `staging` environment, replace `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Merge any change to `main`: its run deploys staging into the new account. Open `https://shkriuss.dev` and `https://<id>.shkriuss.dev`.
- [ ] In the production account, delete the old staging token and the Workers `shkriuss-hub-staging`, `shkriuss-checklists-staging` and `shkriuss-grammar-staging`.
- [ ] Run the verification above. Then ADR 0020 can be accepted, and the threat model's gap G1 closed.

GitHub environments (**Settings → Environments → New environment**):

| Environment  | Deployment branches | Secret                                       | Variable                                          | Protection                                                      |
| ------------ | ------------------- | -------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `staging`    | `main` only         | `CLOUDFLARE_API_TOKEN`: the staging token    | `CLOUDFLARE_ACCOUNT_ID`: the staging account's    | none                                                            |
| `production` | `main` only         | `CLOUDFLARE_API_TOKEN`: the production token | `CLOUDFLARE_ACCOUNT_ID`: the production account's | Required reviewers: you. Leave "Prevent self-review" turned off |

In both zones, redirect `www` to the apex, as [ADR 0001](decisions/0001-domains-and-environments.md) decides (on 2026-10-10 `www` resolved on neither zone):

- [ ] **DNS:** add a proxied `AAAA` record named `www` that points to `100::`.
- [ ] **Rules → Redirect Rules:** create a rule from the template "Redirect from WWW to root".

**After the deployment pull request (step 0.3c) is merged:**

- [ ] The CI run on `main` deploys to staging. Open `https://shkriuss.dev`; Access asks for your email and sends a one-time PIN.
- [ ] In the same run, approve the **production** deployment (**Review deployments**). Then open `https://shkriuss.app`.
- [ ] Scan `https://shkriuss.app` with the MDN HTTP Observatory. The target is A+.

## 4. Each new app

CI deploys every app in `apps/` to staging, `<id>.shkriuss.dev`, from the merge that adds it; the first deployment creates the Worker and its domain, as the hub's did, so nothing needs setting up by hand. A new app is not released (`released: false` in its `app.config.ts`), so production skips it until you release it ([ADR 0015](decisions/0015-releasing-apps.md)):

- [ ] After the merge, open `https://<id>.shkriuss.dev`. Access asks for your email, as for the hub.
- [ ] Check the app on the real devices ([architecture §14](architecture.md#14-browser-support)): the iPhone, the Pixel and the Pixel Tablet, in a tab and installed, offline, and through an update.
- [ ] Release it: a pull request that sets `released: true` in its `app.config.ts`. In the run on `main` that merges it, approve the **production** deployment (**Review deployments**); that first deployment creates `<id>.shkriuss.app`. Then open it.
- [ ] Scan `https://<id>.shkriuss.app` with the MDN HTTP Observatory. The target is A+.
