# Troubleshooting

## Common Issues

### Container Exits Immediately
Check the container logs to see if PostgreSQL or Redis failed to initialize.
```bash
docker logs -f verfix
```

### Dashboard Shows Blank / 500 Error
Ensure you aren't running another service on port `3000`. You can change the dashboard port in `.verfix/.env`.

### Playwright "Executable doesn't exist"
This means the runtime image was built without properly downloading the Chromium binaries. If you are modifying the Dockerfile locally, ensure `npx playwright install chromium` runs successfully.

### Images Not Showing in Replay Tab
By design, Verfix only captures individual event screenshots upon failure or retry. If a test passes seamlessly, the Replay tab will fallback to the final execution snapshot.
