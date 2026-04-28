#!/bin/sh
# Capture configd / DNS / routing state for A/B comparison between
# the stock vpnc-script (via ~/bash/openvpn-connect.exp) and our
# occ-vpnc-script. Run twice: once in each state, then diff the files.
LABEL="${1:-snapshot}"
OUT="$HOME/.occ/diff-${LABEL}-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p "$HOME/.occ"

dump_scutil() {
    echo "--- scutil $1"
    echo "show $1" | scutil
    echo
}

{
    echo "================ LABEL: $LABEL @ $(date -u +%FT%TZ) ================"
    echo
    echo "########## INTERFACE"
    ifconfig | awk '/^utun/{p=1;print;next} /^[a-z]/{p=0} p'
    echo
    echo "########## ROUTES"
    netstat -rn -f inet
    echo
    echo "########## CONFIGD GLOBAL STATE"
    dump_scutil "State:/Network/Global/IPv4"
    dump_scutil "State:/Network/Global/DNS"
    echo
    echo "########## CONFIGD SERVICE LIST"
    echo "list State:/Network/Service/.*" | scutil
    echo
    echo "########## CONFIGD UTUN ENTRIES"
    for u in utun0 utun1 utun2 utun3 utun4 utun5 utun6; do
        for k in IPv4 IPv6 DNS DHCP; do
            key="State:/Network/Service/${u}/${k}"
            # Only dump if it exists (avoid noise)
            if echo "list ${key}" | scutil 2>/dev/null | grep -q "subKey\|${key}"; then
                dump_scutil "${key}"
            fi
        done
    done
    echo
    echo "########## SCUTIL --DNS"
    scutil --dns
    echo
    echo "########## DNS PROBES"
    for h in rndbox4-spb.lab.just-ai.com secretary-stage-qa01.lo.test-ai.net vpn-sls.just-ai.com; do
        echo ">>> system: dscacheutil -q host -a name $h"
        dscacheutil -q host -a name "$h" 2>&1 | head -10
        echo ">>> dig +short $h (system resolver)"
        dig +short +time=2 +tries=1 "$h" 2>&1 | head -3
        echo ">>> dig +short @10.46.1.1 $h (direct VPN DNS)"
        dig @10.46.1.1 +short +time=2 +tries=1 "$h" 2>&1 | head -3
        echo
    done
    echo
    echo "########## ROUTE PROBES"
    for ip in 10.46.1.1 10.43.32.54; do
        echo ">>> route -n get $ip"
        route -n get "$ip" 2>&1
        echo
    done
    echo
    echo "########## OPENCONNECT PROCESS"
    ps -ef | grep -E "openconnect|occ-vpnc|vpnc-script" | grep -v grep
} > "$OUT" 2>&1

echo "Saved: $OUT"
