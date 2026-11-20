#!/usr/bin/env bash
# Concurrency test of the staff-mode caps (pgTAP cannot run parallel sessions): commits a scratch tenant with a
# staff member whose bill_staff_shift_cap is 3, fires 8 staff_submit_bill calls in parallel sessions, expects
# exactly 3 bills, and deletes the scratch tenant. Local stack only; never the real tenant.
#   bash supabase/snippets/bill-parallel-caps.sh [container]   (default supabase_db_FNB_Managment)
set -euo pipefail
export MSYS_NO_PATHCONV=1
C="${1:-supabase_db_FNB_Managment}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STORE=ffffffff-ffff-4fff-8fff-000000029901
USER_ID=eeeeeeee-eeee-4eee-8eee-000000029901
cleanup() {
  docker exec "$C" psql -U postgres -q -c "drop table if exists public.conc_codes; delete from public.tenants where id = 'dddddddd-dddd-4ddd-8ddd-000000029901'; delete from auth.users where id = '$USER_ID';" >/dev/null
}
trap cleanup EXIT
cleanup
SRC="$HERE/bill-parallel-caps.sql"
if command -v cygpath >/dev/null; then SRC="$(cygpath -w "$SRC")"; fi
docker cp "$SRC" "$C:/tmp/bill-parallel-caps.sql"
docker exec "$C" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/bill-parallel-caps.sql
for n in 1 2 3 4 5 6 7 8; do
  docker exec "$C" psql -U postgres -At -c "select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', false) is null; select app.staff_submit_bill('$STORE', (select code from public.conc_codes where n = $n), 'P-$n', 60000) ->> 'state'" >/dev/null &
done
wait
COUNT="$(docker exec "$C" psql -U postgres -At -c "select count(*) from public.bill_captures where store_id = '$STORE'")"
if [ "$COUNT" = "3" ]; then
  echo "ok: 8 parallel bills against a cap of 3 recorded exactly 3"
else
  echo "not ok: expected 3 bills, found $COUNT" >&2
  exit 1
fi
