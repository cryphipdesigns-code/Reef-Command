#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-5.4}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Missing SUPABASE_ACCESS_TOKEN." >&2
  exit 1
fi

if [[ -z "$PROJECT_REF" ]]; then
  echo "Missing SUPABASE_PROJECT_REF." >&2
  exit 1
fi

if [[ -z "$DB_PASSWORD" ]]; then
  echo "Missing SUPABASE_DB_PASSWORD." >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Missing OPENAI_API_KEY." >&2
  exit 1
fi

cd "$ROOT_DIR"

npx supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"
npx supabase db push --password "$DB_PASSWORD"
npx supabase functions deploy generate-insights
npx supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY" OPENAI_MODEL="$OPENAI_MODEL"

ANON_KEY="$(
  npx supabase projects api-keys --project-ref "$PROJECT_REF" -o json \
    | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const data = JSON.parse(input);
  const rows = Array.isArray(data) ? data : (data.api_keys || data.keys || []);
  const anon = rows.find((row) => {
    const haystack = [
      row.name,
      row.key_name,
      row.api_key_name,
      row.type,
      row.key_type,
      row.prefix,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes("anon") || haystack.includes("publishable");
  });
  if (!anon) process.exit(2);
  console.log(anon.api_key || anon.key || anon.value || anon.token || "");
});
'
)"

cat > "$ROOT_DIR/.env.supabase" <<EOF
SUPABASE_PROJECT_REF=$PROJECT_REF
SUPABASE_URL=https://$PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=$ANON_KEY
OPENAI_MODEL=$OPENAI_MODEL
EOF

echo "Supabase deploy complete."
echo "Wrote local app settings to $ROOT_DIR/.env.supabase"
echo "Supabase URL: https://$PROJECT_REF.supabase.co"
