SHELL := /bin/sh

.PHONY: test check start doctor docker-build docker-run

test:
	npm test

check:
	npm run check

start:
	npm start

doctor:
	npm run doctor

docker-build:
	docker build -t azzco/ops-core:local .

docker-run:
	docker compose up --build
