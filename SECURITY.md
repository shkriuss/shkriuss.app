# Security policy

## Reporting a vulnerability

Please report security problems **privately** through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue.

Helpful details:

- the affected app or page (URL), browser and device;
- steps to reproduce;
- what an attacker could achieve.

This is a small project maintained by one person. You will get an acknowledgement as soon as possible. Please allow reasonable time for a fix before disclosing the issue publicly.

## Scope

In scope:

- the code in this repository;
- the sites it deploys: `shkriuss.app` and `*.shkriuss.app`.

Out of scope:

- the private staging environment (`shkriuss.dev` and its subdomains);
- denial-of-service and volumetric attacks;
- social engineering and physical attacks;
- issues that require an already compromised device, browser or browser extension.

## Design

How the apps are protected is described in the [threat model](docs/threat-model.md).
