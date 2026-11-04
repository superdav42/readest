#!/usr/bin/env bash
# Added 2026-11-04 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
#
# Unit tests for the pre-push hook (.husky/pre-push):
# - on Node 24, like CI (.github/workflows/pull-request.yml); an older host Node runs the
#   tests through npm's `node@24` package (downloaded once into the npx cache);
# - four workers like CI's test:pr:web:unit, and two retries for timing-sensitive tests,
#   because a fully loaded machine makes them time out;
# - the generated pdf.js vendor files (gitignored) are set up first when missing;
# - files listed in scripts/test-prepush-skip.txt are left out (each line names its issue).
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node_24() {
	local major
	major="$(node -p 'process.versions.node.split(".")[0]')"
	if [ "$major" -ge 24 ]; then
		command -v node
		return 0
	fi
	npx -y -p node@24 node -e 'process.stdout.write(process.execPath)'
	return 0
}

main() {
	local node_bin line
	local -a excludes=()
	node_bin="$(node_24)"
	while IFS= read -r line || [ -n "$line" ]; do
		line="${line%%#*}"
		line="${line//[[:space:]]/}"
		if [ -n "$line" ]; then
			excludes+=(--exclude "$line")
		fi
	done <"$app_dir/scripts/test-prepush-skip.txt"
	cd "$app_dir"
	if [ ! -f public/vendor/pdfjs/pdf.worker.min.mjs ]; then
		pnpm setup-vendors
	fi
	npx dotenv -e .env -e .env.test.local -- \
		"$node_bin" node_modules/vitest/vitest.mjs run --maxWorkers=4 --retry=2 "${excludes[@]}"
	return $?
}

main "$@"
