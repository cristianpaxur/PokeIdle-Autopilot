#!/usr/bin/env bash
set -euo pipefail

children=()
app_pid=

cleanup() {
  trap - EXIT TERM INT
  if [[ -n "$app_pid" ]]; then
    kill -TERM "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if (( ${#children[@]} )); then
    kill -TERM "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' TERM INT

for profile in 1 2 3 4; do
  # These profiles belong to this service. No browser has started yet.
  for lock in /data/profiles/"$profile"/Singleton{Lock,Cookie,Socket}; do
    if [[ -L "$lock" ]]; then rm -- "$lock"; fi
  done
  display=":$((10 + profile))"
  Xvfb "$display" -screen 0 1280x800x24 -nolisten tcp -noreset &
  children+=("$!")
  for attempt in {1..50}; do
    if xdpyinfo -display "$display" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  xdpyinfo -display "$display" >/dev/null
  DISPLAY="$display" openbox --sm-disable >/dev/null 2>&1 &
  children+=("$!")
  flags=(-display "$display" -localhost -listen 127.0.0.1 -nopw -forever -shared -noremote -nosel -quiet -wait 10 -defer 5)
  x11vnc "${flags[@]}" -rfbport "$((5910 + profile))" -viewonly &
  children+=("$!")
  x11vnc "${flags[@]}" -rfbport "$((5920 + profile))" &
  children+=("$!")
done

node src/main.mjs &
app_pid=$!
wait -n "$app_pid" "${children[@]}"
exit 1
