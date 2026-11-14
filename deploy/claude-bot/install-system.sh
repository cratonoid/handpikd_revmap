#!/bin/bash
# Root part of the claude-bot setup. Idempotent. Run from this directory:
#   sudo bash install-system.sh
set -euo pipefail
cd "$(dirname "$0")"

# 1. The user. No password (login only via `sudo -u claude-bot -i`), not in
#    the docker or sudo groups.
id claude-bot >/dev/null 2>&1 || useradd --create-home --shell /bin/bash claude-bot
chmod 750 /home/claude-bot

# 2. Lock down secrets claude-bot (and any other user) could read so far.
chmod 640 /opt/handpikd_revmap/backend/.env
chmod 600 /opt/handpikd_revmap/backend/.env.bak-* 2>/dev/null || true
chmod o-rwx /srv/handpikd-backups /srv/handpikd-purchase-invoices

# 3. Ops helpers (root-owned, fixed commands) + sudoers + PATH wrappers.
install -o root -g root -m 755 sbin/handpikd-restart sbin/handpikd-status sbin/handpikd-logs /usr/local/sbin/
for c in restart status logs; do
  printf '#!/bin/sh\nexec sudo -n /usr/local/sbin/handpikd-%s\n' "$c" > "/usr/local/bin/handpikd-$c"
  chmod 755 "/usr/local/bin/handpikd-$c"
done
install -o root -g root -m 440 claude-bot.sudoers /etc/sudoers.d/claude-bot.new
visudo -cf /etc/sudoers.d/claude-bot.new
mv /etc/sudoers.d/claude-bot.new /etc/sudoers.d/claude-bot

# 4. Permission policy claude-bot can't edit.
install -d -o root -g root -m 755 /etc/claude-code
install -o root -g root -m 644 managed-settings.json /etc/claude-code/managed-settings.json

# 5. systemd unit: installed, NOT enabled or started.
install -o root -g root -m 644 claude-telegram.service /etc/systemd/system/claude-telegram.service
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/claude-telegram.service || true
echo "system setup done"
