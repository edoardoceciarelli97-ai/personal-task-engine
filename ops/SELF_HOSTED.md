# Isolated personal VM operation

This remains the same standalone personal client. It is not a hosted application
provider, generic HTTP proxy or commercial backend. Use one refresh owner only.
Create a distinct VM host UUID before import. Import only the selected client's
registration, retaining its client ID, subject and tokens, while preserving the
VM host record and rebinding the local grant metadata to that host. Do not modify
signed token contents. Transferred-session host attribution is not asserted.

The service is a boot-persistent, oneshot readiness check (active/exited), with no
listener and no inference scheduler. Its process has no network access. Invoke
the CLI manually as the dedicated user for catalog/necessary refresh and separately
consented jobs. Automation commands remain subject to their bounded consent gate;
no watch service or inference timer is installed by this deployment.

Keep code root-owned and data user-owned 0700/0600. Do not add the user to sudo,
Docker or application groups. Back up SQLite using the SQLite backup API, then
verify a read-only restored copy including the audit chain. Keep credential
backups root-only and never activate an older refresh token as a rollback. Roll
back code/service configuration separately from current grant and ledger state.
After successful transfer and remote verification, remove the source grant from
the local client's active filename, retaining a protected disabled recovery copy.
Use the VM as the only refresh authority. To revoke, disable the service and revoke
the registration in the personal ChatGPT settings; local deletion alone is not
proof of provider revocation.

Official procedure:
https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
