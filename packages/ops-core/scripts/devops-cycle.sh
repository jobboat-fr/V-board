#!/bin/sh
set -eu

echo "1/5 syntax"
find src tests -name "*.js" -print | while read -r file; do
  node --check "$file"
done

echo "2/5 tests"
npm test

echo "3/5 doctor"
npm run doctor

echo "4/5 docker build check"
if command -v docker >/dev/null 2>&1; then
  docker build -t azzco/ops-core:devops-cycle .
else
  echo "docker not found; skipping docker build"
fi

echo "5/5 done"
