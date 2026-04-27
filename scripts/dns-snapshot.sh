#!/bin/sh
# Capture VPN/DNS state for comparison between our CLI and AnyConnect GUI.
# Usage: ./dns-snapshot.sh <label>      e.g. ./dns-snapshot.sh occ
#                                            ./dns-snapshot.sh anyconnect
LABEL="${1:-snapshot}"
OUT="$HOME/.occ/snapshot-${LABEL}-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p "$HOME/.occ"

{
    echo "=== LABEL: $LABEL @ $(date -u +%FT%TZ) ==="
    echo
    echo "--- ifconfig (utun*) ---"
    ifconfig | awk '/^utun/{p=1;print;next} /^[a-z]/{p=0} p'
    echo
    echo "--- netstat -rn -f inet ---"
    netstat -rn -f inet
    echo
    echo "--- scutil --dns ---"
    scutil --dns
    echo
    echo "--- scutil State:/Network/Service list ---"
    echo 'list State:/Network/Service/.*' | scutil
    echo
    echo "--- scutil Setup:/Network/Service list ---"
    echo 'list Setup:/Network/Service/.*' | scutil
    echo
    echo "--- ps for openconnect / vpnagentd ---"
    ps -ax | grep -E "openconnect|vpnagent|cisco" | grep -v grep
    echo
    echo "--- DNS resolution probes ---"
    for h in rndbox4-spb.lab.just-ai.com vpn-sls.just-ai.com just-ai.com; do
        echo ">>> dscacheutil $h"
        dscacheutil -q host -a name "$h" 2>&1 | head -10
        echo ">>> dig +short $h"
        dig +short +time=2 +tries=1 "$h" 2>&1 | head -5
    done
} > "$OUT" 2>&1

echo "Saved: $OUT"
