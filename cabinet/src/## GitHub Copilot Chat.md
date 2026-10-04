## GitHub Copilot Chat

- Extension: 0.68.0 (prod)
- VS Code: 1.140.0 (07f806f999227108933c2e30515b26eecc1fda74)
- OS: win32 10.0.26200 x64
- GitHub Account: avenidoearllouieo-art

## Network

User Settings:
```json
  "http.systemCertificatesNode": true,
  "telemetry.telemetryLevel": "all",
  "github.copilot.advanced.debug.useElectronFetcher": false,
  "github.copilot.advanced.debug.useNodeFetcher": false,
  "github.copilot.advanced.debug.useNodeFetchFetcher": true
```

Connecting to https://api.github.com:
- DNS ipv4 Lookup: 20.205.243.168 (105 ms)
- DNS ipv6 Lookup: Error (41 ms): getaddrinfo ENOTFOUND api.github.com
- Proxy URL: None (3 ms)
- Electron fetch: HTTP 200 (215 ms)
- Node.js https: HTTP 200 (263 ms)
- Node.js fetch (configured): HTTP 200 (73 ms)

Connecting to https://api.individual.githubcopilot.com/_ping:
- DNS ipv4 Lookup: 140.82.113.21 (20 ms)
- DNS ipv6 Lookup: Error (21 ms): getaddrinfo ENOTFOUND api.individual.githubcopilot.com
- Proxy URL: None (6 ms)
- Electron fetch: HTTP 200 (866 ms)
- Node.js https: HTTP 200 (813 ms)
- Node.js fetch (configured): HTTP 200 (294 ms)

Connecting to https://proxy.individual.githubcopilot.com/_ping:
- DNS ipv4 Lookup: 4.237.22.41 (35 ms)
- DNS ipv6 Lookup: Error (22 ms): getaddrinfo ENOTFOUND proxy.individual.githubcopilot.com
- Proxy URL: None (4 ms)
- Electron fetch: HTTP 200 (695 ms)
- Node.js https: HTTP 200 (691 ms)
- Node.js fetch (configured): HTTP 200 (212 ms)

Connecting to https://mobile.events.data.microsoft.com/OneCollector/1.0?cors=true&content-type=application/x-json-stream (Node.js fetch): HTTP 200 (348 ms)
Connecting to https://telemetry.individual.githubcopilot.com/telemetry (Node.js https): HTTP 200 (799 ms)
Connecting to https://default.exp-tas.com/vscode/ab (Node.js fetch): HTTP 200 (85 ms)

Number of system certificates: 87

## Notes

- Active fetcher: Node.js fetch.
- For corporate networks also see: [Troubleshooting firewall settings for GitHub Copilot](https://docs.github.com/en/copilot/troubleshooting-github-copilot/troubleshooting-firewall-settings-for-github-copilot).