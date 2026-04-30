# Tunnel MCP Server

Step-by-step playbook for starting the MCP dev server and exposing it via a public tunnel (cloudflared or ngrok). Useful for testing with remote MCP clients or sharing a live preview.

## Step 1: Find the Dev Command

Look for a dev script in `package.json`:

```bash
cat package.json | grep -A2 '"dev"'
```

Common patterns:
- `bun run dev`
- `npm run dev`
- `npx ts-node src/index.ts`
- `node dist/index.js`

If no dev script exists, ask the user how to start their server.

## Step 2: Start the Dev Server

Run the dev command in the background and capture the port:

```bash
# Start the server (use whichever package manager the project uses)
bun run dev &
```

Wait a few seconds for the server to start, then detect the port:

```bash
# Check which port the server is listening on
lsof -iTCP -sTCP:LISTEN -P -n | grep -E '(bun|node|deno)' | awk '{print $9}' | sed 's/.*://'
```

If multiple ports are found, ask the user which one to tunnel. Common MCP server ports: 3000, 3001, 8080, 8787.

If no port is detected:
- Check the server logs for "listening on port XXXX"
- Look for a PORT env var in `.env` or the dev script
- Ask the user what port the server runs on

## Step 3: Choose a Tunnel Provider

Check which tunnel tools are available:

```bash
# Check for cloudflared
which cloudflared 2>/dev/null && echo "cloudflared: available" || echo "cloudflared: not found"

# Check for ngrok
which ngrok 2>/dev/null && echo "ngrok: available" || echo "ngrok: not found"
```

### If cloudflared is available (preferred)

```bash
cloudflared tunnel --url http://localhost:<PORT>
```

Cloudflared will print a public URL like `https://<random>.trycloudflare.com`. No account required for quick tunnels.

### If ngrok is available

```bash
ngrok http <PORT>
```

Ngrok will print a public URL like `https://<random>.ngrok-free.app`. May require a free account and auth token.

### If neither is available

Tell the user:

> *"No tunnel tool found. Install one:*
>
> - **cloudflared** (recommended, no account needed):
>   - macOS: `brew install cloudflared`
>   - Linux: `curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt update && sudo apt install cloudflared`
>
> - **ngrok**:
>   - macOS: `brew install ngrok`
>   - Linux: `snap install ngrok`
>   - Then: `ngrok config add-authtoken <your-token>` (get one at [ngrok.com](https://ngrok.com))*"

After they install one, re-run the check and proceed.

## Step 4: Print the Result

Once the tunnel is running, print:

```
MCP server tunneled:

  Local:  http://localhost:<PORT>
  Public: <TUNNEL_URL>

Use the public URL as your MCP server endpoint.
The tunnel stays open as long as this process is running. Press Ctrl+C to stop.
```

## Important Notes

- **cloudflared quick tunnels** generate a new random URL each time. For a stable URL, the user needs to set up a named tunnel with `cloudflared tunnel create`.
- **ngrok free tier** has rate limits and session expiry. The URL changes on restart unless on a paid plan.
- **Both the dev server and the tunnel must stay running.** If either process stops, the public URL will stop working.
- If the user's MCP server uses SSE transport, the tunnel URL replaces `localhost` in the client config. If it uses stdio, a tunnel is not needed.
