.PHONY: up down api worker ui cli

up:
	docker-compose up -d

down:
	docker-compose down

api:
	cd api && GOTOOLCHAIN=local ~/.local/go/bin/go run main.go

worker:
	cd workers && npm run dev

ui:
	cd dashboard && npm run dev

cli:
	cd cli && npm run dev --

.PHONY: tidy
tidy:
	cd api && GOTOOLCHAIN=local ~/.local/go/bin/go mod tidy
