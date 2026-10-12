#!/usr/bin/env bash
# اجرای همه مجموعه‌های e2e روی ماتریس دستگاه‌ها (اندازه × نوار ناوبری × صفحه‌کلید) به‌صورت موازی.
# نیاز: npx vite preview --port 4173 --host 0.0.0.0
cd "$(dirname "$0")/.."
SUITES="intro polish products purchases sales money returns stock reports backup picker"
CONFIGS=(${CONFIGS_OVERRIDE:-"360x780 3btn closed" "360x780 gesture open" "412x915 3btn open" "412x915 gesture closed"})
mkdir -p /tmp/walk
for c in "${CONFIGS[@]}"; do
  set -- $c
  ( for s in $SUITES; do
      out=$(DEVICE=$1 INSETS=$2 KB=$3 timeout 900 node scripts/e2e-$s.mjs 2>&1); code=$?
      n=$(echo "$out" | grep -cE "^\s*(PASS|✓)"); f=$(echo "$out" | grep -cE "^\s*(FAIL|✗)")
      echo "$1 $2 kb-$3 | $s | exit=$code pass=$n fail=$f"
      [ $code -ne 0 ] && echo "$out" | grep -E "FAIL|✗|Error" | head -5 | sed 's/^/    /'
    done ) > "/tmp/walk/$1-$2-$3.log" 2>&1 &
done
wait
cat /tmp/walk/*.log
